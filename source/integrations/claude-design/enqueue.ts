// Writes the one bit of PHP this branch authors: a sentinel-bounded,
// idempotent block in the theme's functions.php that enqueues the
// stylesheet + any assets/*.js + the web fonts the design depends on,
// and emits the no-flash <head> snippet (so a theme toggle applies
// before first paint). Block themes do NOT auto-enqueue style.css on the
// front end, and nothing else enqueues the package's JS or fonts, so
// without this the residual CSS, the toggle, and the fonts silently fail.
//
// The block is delimited by sentinels; a re-import replaces only the
// region between them, leaving the rest of functions.php untouched.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {writeFileAtomic} from '../../lib/atomic-write.js';
import type {LogEvent} from '../../lib/event-list.js';

const START = '// @neptune-enqueue-start';
const END = '// @neptune-enqueue-end';

export type HeadBits = {
	// The href of the design's web-fonts stylesheet (Google Fonts etc.),
	// lifted from a static reference's <head>. null when none found.
	fontsHref: string | null;
	// The inner JS of the no-flash theme snippet from the reference's
	// <head>, without the surrounding <script> tags. null when none.
	noFlashScript: string | null;
};

// Pulls the web-fonts <link> href and the no-flash inline <script> body
// out of a static reference page's <head>. Best-effort and regex-based:
// these are small, well-formed fragments, and a miss just means that bit
// isn't enqueued (theme.json still declares the font stacks).
// Decodes the handful of HTML entities that appear in attribute values.
// Critically, web-font hrefs in static HTML carry `&amp;` between query
// params (`family=A&amp;family=B&amp;display=swap`); enqueuing that
// verbatim makes WordPress request a URL with a literal `&amp;`, which the
// font CDN rejects, so fonts silently fail to load.
function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&#0*38;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#0*39;/g, "'")
		.replace(/&apos;/g, "'");
}

export function extractHeadBits(html: string): HeadBits {
	const head = /<head[\s\S]*?<\/head>/i.exec(html)?.[0] ?? html;

	let fontsHref: string | null = null;
	const linkRe = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = linkRe.exec(head)) !== null) {
		const tag = m[0];
		const href = m[1]!;
		if (
			/rel=["']stylesheet["']/i.test(tag) &&
			/fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit/i.test(href)
		) {
			fontsHref = decodeEntities(href);
			break;
		}
	}

	let noFlashScript: string | null = null;
	const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
	while ((m = scriptRe.exec(head)) !== null) {
		const body = m[1] ?? '';
		// The no-flash snippet reads/writes localStorage and sets a theme
		// attribute. Match on that intent; ignore analytics etc.
		if (/localStorage/.test(body) && /data-theme|documentElement/.test(body)) {
			noFlashScript = body.trim();
			break;
		}
	}

	return {fontsHref, noFlashScript};
}

function phpSingleQuote(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildBlock(
	scriptFiles: string[],
	designCssRel: string | null,
	bits: HeadBits,
): string {
	const lines: string[] = [];
	lines.push(START);
	lines.push("// Managed by Neptune's Claude Design import. Edits between the");
	lines.push('// @neptune-enqueue sentinels are overwritten on re-import.');
	lines.push("add_action( 'wp_enqueue_scripts', function () {");
	lines.push('\t$uri = get_stylesheet_directory_uri();');
	lines.push("\t$ver = wp_get_theme()->get( 'Version' );");
	// The theme's own style.css is enqueued by the starter's functions.php;
	// we only add the auxiliary design stylesheet (loaded after it so its
	// rules win) plus fonts + behaviour scripts.
	if (designCssRel) {
		lines.push(
			`\twp_enqueue_style( 'neptune-design', $uri . '/${phpSingleQuote(designCssRel)}', array(), $ver );`,
		);
	}
	if (bits.fontsHref) {
		lines.push(
			`\twp_enqueue_style( 'neptune-fonts', '${phpSingleQuote(bits.fontsHref)}', array(), null );`,
		);
	}
	for (const file of scriptFiles) {
		const handle =
			'neptune-asset-' + file.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
		lines.push(
			`\twp_enqueue_script( '${phpSingleQuote(handle)}', $uri . '/assets/${phpSingleQuote(file)}', array(), $ver, true );`,
		);
	}
	lines.push('} );');

	// No-flash head snippet, emitted inside a PHP NOWDOC so the script body
	// is treated as literal text — no `?>` can break out of PHP and no
	// interpolation occurs. The only hazard is the body containing a line
	// equal to the heredoc terminator, which we guard against.
	const TERM = 'NEPTUNE_HEAD_HTML';
	if (bits.noFlashScript && !bits.noFlashScript.includes(TERM)) {
		lines.push("add_action( 'wp_head', function () {");
		lines.push(`\techo <<<'${TERM}'`);
		lines.push(`<script>${bits.noFlashScript}</script>`);
		lines.push(`${TERM};`);
		lines.push('}, 0 );');
	}
	lines.push(END);
	return lines.join('\n');
}

// Splices the managed enqueue block into <themeDir>/functions.php. Creates
// the file (with an opening <?php) when absent. Idempotent: a prior block
// is replaced in place.
export async function applyEnqueue(
	themeDir: string,
	scriptFiles: string[],
	designCssRel: string | null,
	bits: HeadBits,
	onEvent: (ev: LogEvent) => void,
): Promise<void> {
	const path = join(themeDir, 'functions.php');
	let existing: string | null;
	try {
		existing = await readFile(path, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') existing = null;
		else throw err;
	}

	const block = buildBlock(scriptFiles, designCssRel, bits);

	let next: string;
	if (existing === null) {
		next = `<?php\n// Theme bootstrap (created by Neptune Claude Design import).\n\n${block}\n`;
		onEvent({
			kind: 'step',
			message: 'Created functions.php with enqueue block.',
		});
	} else if (existing.includes(START) && existing.includes(END)) {
		const re = new RegExp(
			escapeRegExp(START) + '[\\s\\S]*?' + escapeRegExp(END),
		);
		next = existing.replace(re, block);
		onEvent({
			kind: 'step',
			message: 'Updated managed enqueue block in functions.php.',
		});
	} else {
		const sep = existing.endsWith('\n') ? '\n' : '\n\n';
		next = existing + sep + block + '\n';
		onEvent({
			kind: 'step',
			message: 'Appended enqueue block to functions.php.',
		});
	}

	await writeFileAtomic(path, next);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
