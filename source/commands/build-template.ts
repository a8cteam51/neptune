// Shared core for the template-build flow. Feeds one pull's
// design/<slug>/code.tsx (plus the theme's theme.json,
// variables/all-variables.json, and any existing block style
// variations) to the Claude Agent SDK with the tsx-to-blocks skill,
// then writes the resulting Gutenberg block markup to the pull's
// wp_template / wp_template_part post in the WordPress database via
// Studio's wp-cli.
//
// The UI shell lives in build-templates.tsx — it picks the pulls and
// calls runBuild for each. This module owns no React; it's pure I/O
// + agent invocation.
import {readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	runAgent,
	type ImageBlock,
	type TextBlock,
} from '../lib/agent-stream.js';
import {readBufferIfExists, readIfExists} from '../lib/fs-helpers.js';
import {
	extractDevAnnotations,
	formatDevAnnotationsSection,
} from '../lib/dev-annotations.js';
import {
	applyBlockStyleVariations,
	applyThemeJsonPatch,
	flushThemeJsonCache,
	formatBlockStyleVariationsContext,
	readBlockStyleVariations,
} from '../lib/theme-json-patch.js';
import {parseBuildEnvelope} from '../lib/build-envelope.js';
import {
	formatRegisteredPatternsContext,
	listRegisteredPatterns,
} from '../lib/patterns.js';
import type {LogEvent} from '../lib/event-list.js';
import {templateRole, type TemplateRole} from '../lib/template-scaffold.js';
import {
	targetLabel,
	templateTargetFor,
	writeTemplate,
} from '../lib/wp-templates.js';
import {openStudioSession} from '../integrations/studio/mcp.js';
import type {Loaded} from './setup-project/types.js';
import type {PullMeta} from '../lib/types.js';

export type TemplateBuildPull = PullMeta & {templateFile: string};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = resolve(moduleDir, '..', '..', 'plugins', 'neptune-tools');

export type BuildDeps = {
	runAgent?: typeof runAgent;
};

export async function runBuild(
	loaded: Loaded,
	pull: TemplateBuildPull,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: BuildDeps = {},
): Promise<{path: string; size: number}> {
	const agentRunner = deps.runAgent ?? runAgent;
	const themeSlug = loaded.config.themeSlug!;

	const codePath = join(loaded.dir, 'design', pull.slug, 'code.tsx');
	const code = await readFile(codePath, 'utf8');
	onEvent({
		kind: 'step',
		message: `Loaded design/${pull.slug}/code.tsx (${code.length} bytes)`,
	});

	const themeJsonPath = resolve(
		loaded.dir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
		'theme.json',
	);
	const themeJsonText = await readIfExists(themeJsonPath);
	if (themeJsonText) {
		onEvent({
			kind: 'step',
			message: `Loaded theme.json (${themeJsonText.length} bytes)`,
		});
	} else {
		onEvent({kind: 'warn', message: 'No theme.json found — proceeding without it'});
	}

	const variablesPath = join(loaded.dir, 'variables', 'all-variables.json');
	const variablesText = await readIfExists(variablesPath);
	if (variablesText) {
		onEvent({
			kind: 'step',
			message: `Loaded variables/all-variables.json (${variablesText.length} bytes)`,
		});
	} else {
		onEvent({
			kind: 'warn',
			message: 'No variables/all-variables.json — proceeding without it',
		});
	}

	const wpRoot = resolve(loaded.dir, 'wordpress');
	const themePath = resolve(wpRoot, 'wp-content', 'themes', themeSlug);
	const existingVariations = await readBlockStyleVariations(
		themePath,
		msg => onEvent({kind: 'warn', message: msg}),
	);
	const variationsContext = formatBlockStyleVariationsContext(
		existingVariations,
	);
	if (variationsContext) {
		onEvent({
			kind: 'step',
			message: `Loaded ${existingVariations.length} existing block style variation${existingVariations.length === 1 ? '' : 's'} for reuse context`,
		});
	}

	const registeredPatterns = await listRegisteredPatterns(
		loaded.dir,
		themeSlug,
	);
	const patternsContext = formatRegisteredPatternsContext(registeredPatterns);
	if (patternsContext) {
		onEvent({
			kind: 'step',
			message: `Loaded ${registeredPatterns.length} registered pattern${registeredPatterns.length === 1 ? '' : 's'} for reuse context`,
		});
	}

	const baseSections: string[] = ['=== code.tsx ===', code];
	if (themeJsonText) {
		baseSections.push('', '=== theme.json ===', themeJsonText);
	}
	if (variablesText) {
		baseSections.push('', '=== variables.json ===', variablesText);
	}
	if (variationsContext) {
		baseSections.push(
			'',
			'=== existing block style variations ===',
			'These variations are already registered. Reuse them by adding the matching `is-style-<slug>` class to a block instead of redefining them. Only emit a new entry in `block_style_variations[]` when none of these fits.',
			variationsContext,
		);
	}
	if (patternsContext) {
		baseSections.push(
			'',
			'=== registered patterns ===',
			'These block patterns are already registered in the theme. When code.tsx invokes a function whose PascalCase name matches one of these `name` entries, emit `<!-- wp:pattern {"slug":"<slug>"} /-->` for that JSX element instead of inlining the function body. Use the `slug` field verbatim. Match is case-sensitive and exact on the function name.',
			patternsContext,
		);
	}
	const devAnnotations = extractDevAnnotations(code);
	if (devAnnotations.length > 0) {
		const noteCount = devAnnotations.reduce(
			(sum, a) => sum + a.notes.length,
			0,
		);
		baseSections.push(
			'',
			'=== dev annotations ===',
			formatDevAnnotationsSection(devAnnotations),
		);
		onEvent({
			kind: 'step',
			message: `Captured ${noteCount} dev annotation${noteCount === 1 ? '' : 's'} on ${devAnnotations.length} node${devAnnotations.length === 1 ? '' : 's'}`,
		});
	}
	const placeholder = loaded.config.placeholderImage;
	if (placeholder) {
		baseSections.push('', '=== placeholder image ===', placeholderInstructions(placeholder));
	}
	const baseContext = baseSections.join('\n');

	const screenshotPath = join(
		loaded.dir,
		'design',
		pull.slug,
		'screenshot.png',
	);
	const screenshotBuf = await readBufferIfExists(screenshotPath);
	if (screenshotBuf) {
		onEvent({
			kind: 'step',
			message: `Loaded screenshot.png (${screenshotBuf.length} bytes)`,
		});
	} else {
		onEvent({
			kind: 'warn',
			message: 'No screenshot.png — proceeding without visual reference',
		});
	}
	const screenshotBase64 = screenshotBuf
		? screenshotBuf.toString('base64')
		: null;

	const userContent = buildUserContent(
		pull.templateFile,
		baseContext,
		screenshotBase64,
		pull.usesPostContent === true,
	);

	onEvent({kind: 'step', message: 'Invoking Claude Agent SDK…'});

	const responseText = await agentRunner(
		userContent,
		{cwd: loaded.dir, pluginPath: PLUGIN_PATH, signal},
		onEvent,
	);

	const envelope = parseBuildEnvelope(responseText, 'build-template');
	const target = templateTargetFor(pull.templateFile, pull.pageName);
	const out = envelope.template_html.endsWith('\n')
		? envelope.template_html
		: envelope.template_html + '\n';

	const session = await openStudioSession({signal});
	let cacheNeedsFlush = false;
	try {
		await writeTemplate(session, wpRoot, target, out);
		if (envelope.theme_json_patch) {
			const patchResult = await applyThemeJsonPatch(
				themeJsonPath,
				envelope.theme_json_patch,
			);
			if (patchResult.wrote) {
				onEvent({
					kind: 'success',
					message: `Patched theme.json (${patchResult.touched.join(', ')})`,
				});
				cacheNeedsFlush = true;
			}
		}
		if (envelope.block_style_variations) {
			const writeResult = await applyBlockStyleVariations(
				themePath,
				envelope.block_style_variations,
			);
			if (writeResult.written.length > 0) {
				onEvent({
					kind: 'success',
					message: `Registered ${writeResult.written.length} block style variation${writeResult.written.length === 1 ? '' : 's'}`,
				});
				cacheNeedsFlush = true;
			}
		}
		if (cacheNeedsFlush) {
			await flushThemeJsonCache(session, wpRoot);
		}
	} finally {
		session.close();
	}

	const label = targetLabel(target);
	onEvent({
		kind: 'success',
		message: `Wrote ${out.length} bytes to ${label}`,
	});

	return {path: label, size: out.length};
}

type UserContent = Array<TextBlock | ImageBlock>;

// We rely on the tsx-to-blocks skill to know HOW to convert. The lead
// sentence keeps the trigger words from the skill's description so the
// SDK auto-invokes it; the skill body owns the conversion rules. The
// per-call dynamic context is the template's role (header/footer/page),
// which the skill cannot infer from code.tsx alone.
function buildUserContent(
	templateFile: string,
	baseContext: string,
	screenshotBase64: string | null,
	usesPostContent: boolean,
): UserContent {
	const role = templateRole(templateFile);
	const content: UserContent = [];

	const wrapperNote = usesPostContent
		? ' This template embeds the page body via wp:post-content. The TSX has a region marked with data-neptune-annotations="post-content" — replace that subtree with `<!-- wp:post-content /-->` and convert ONLY the surrounding chrome (post title, post date, comments, etc.). Do NOT convert the marked subtree itself; build-content will handle it.'
		: '';

	content.push({
		type: 'text',
		text:
			`Convert this Figma-generated React + Tailwind component (code.tsx) to Gutenberg block markup for the WordPress block theme template ${templateFile} (role: ${role}). Use the tsx-to-blocks skill. ${roleScopeNote(role)}${wrapperNote}`,
	});

	if (screenshotBase64) {
		content.push({
			type: 'text',
			text: '=== screenshot.png — visual reference for the intended design output ===',
		});
		content.push({
			type: 'image',
			source: {
				type: 'base64',
				media_type: 'image/png',
				data: screenshotBase64,
			},
		});
	}

	content.push({type: 'text', text: baseContext});

	return content;
}

// Instructions appended to the agent prompt when a placeholder image
// has been registered. Both the build and refine flows share this so
// the rule is identical in both contexts.
export function placeholderInstructions(placeholder: {
	id: number;
	url: string;
}): string {
	return [
		`A placeholder image is uploaded to the WordPress media library.`,
		`Use it for EVERY wp:image block you emit:`,
		`  - Block attrs: {"id":${placeholder.id}}`,
		`  - <img> src: ${placeholder.url}`,
		`  - <img> class includes: wp-image-${placeholder.id}`,
		`Never leave src empty and never invent a different URL.`,
	].join('\n');
}

export function roleScopeNote(role: TemplateRole): string {
	if (role === 'header') {
		return 'Convert ONLY the header region of the source page (site title, primary nav, top bar). Ignore main content and footer.';
	}
	if (role === 'footer') {
		return 'Convert ONLY the footer region of the source page (site info, secondary nav, copyright). Ignore header and main content.';
	}
	return 'Convert ONLY the main content region of the source page. Header and footer are rendered separately by parts/header.html and parts/footer.html — skip them.';
}

