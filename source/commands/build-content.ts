// Shared core for the page-content build flow. Feeds one
// usesPostContent pull's design/<slug>/code.tsx (plus theme.json,
// variables/all-variables.json, any existing block style variations,
// dev annotations, the registered-patterns inventory, and the
// per-pull media library mappings) to the agent with the tsx-to-blocks
// + pull-writer skills loaded and a Haydi MCP server attached. The
// agent converts the marked subtree and persists it to the running
// site directly via haydi_run_php; the host post-flight-verifies via
// a direct Haydi REST call and reports the size.
//
// Mirrors build-template, but: only sees pulls flagged usesPostContent;
// targets a wp_post (page or post) via Haydi MCP; tells the conversion
// skill to convert ONLY the data-neptune-annotations="post-content"
// subtree.
//
// The UI shell lives in build-contents.tsx — it picks the pulls and
// calls runBuildContent for each. This module owns no React.
import {readFile} from 'node:fs/promises';
import {readBufferIfExists, readIfExists} from '../lib/fs-helpers.js';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	runAgent,
	type ImageBlock,
	type TextBlock,
} from '../lib/agent-stream.js';
import {
	extractDevAnnotations,
	formatDevAnnotationsSection,
} from '../lib/dev-annotations.js';
import {
	formatBlockStyleVariationsContext,
	readBlockStyleVariations,
} from '../lib/theme-json-patch.js';
import {formatAssetMappingsContext} from '../lib/asset-mappings.js';
import {
	formatRegisteredPatternsContext,
	listRegisteredPatterns,
} from '../lib/patterns.js';
import type {LogEvent} from '../lib/event-list.js';
import {HAYDI_TOOL_ALLOWLIST, haydiMcpServers} from '../lib/haydi-mcp.js';
import {preflight, runPhp} from '../integrations/haydi/client.js';
import type {HaydiConfig, Loaded} from './setup-project/types.js';
import type {PullMeta} from '../lib/types.js';
import type {PagePostType} from '../lib/wp-pages.js';

export type ContentBuildPull = PullMeta & {pageSlug: string};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = resolve(moduleDir, '..', '..', 'plugins', 'neptune-tools');
const PAGE_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export type BuildDeps = {
	runAgent?: typeof runAgent;
};

export async function runBuildContent(
	loaded: Loaded,
	pull: ContentBuildPull,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: BuildDeps = {},
): Promise<{path: string; size: number}> {
	const agentRunner = deps.runAgent ?? runAgent;
	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error(
			'themeSlug missing from neptune-config.json — finish theme setup first.',
		);
	}
	const haydi = loaded.config.haydi;
	if (!haydi) {
		throw new Error(
			'haydi config missing from neptune-config.json. Build content persists to the running site via Haydi MCP; add { "haydi": { "url": "...", "token": "..." } } to the project config (token from WP Admin → Haydi → Remote Access).',
		);
	}

	const postType: PagePostType = pull.postType ?? 'page';
	if (postType !== 'page' && postType !== 'post') {
		throw new Error(
			`Pull postType must be 'page' or 'post'; got ${JSON.stringify(postType)}.`,
		);
	}
	const pageSlug = pull.pageSlug;
	if (!PAGE_SLUG_RE.test(pageSlug)) {
		throw new Error(
			`Pull pageSlug "${pageSlug}" does not match ${PAGE_SLUG_RE} — refusing to interpolate into a PHP snippet.`,
		);
	}
	const pageName = pull.pageName;
	const label = `${postType}:${pageSlug}`;

	// Pre-flight: site reachable, token works, extensions present.
	onEvent({kind: 'step', message: `Pinging Haydi at ${haydi.url}…`});
	await preflight(haydi, signal);
	onEvent({kind: 'step', message: 'Haydi extensions verified'});

	// Pre-flight: code.tsx has the post-content annotation. Failing
	// here is a config error, not an agent failure — flag clearly.
	const codePath = join(loaded.dir, 'design', pull.slug, 'code.tsx');
	const code = await readFile(codePath, 'utf8');
	if (!/data-neptune-annotations="post-content"/.test(code)) {
		throw new Error(
			'code.tsx has no data-neptune-annotations="post-content" region. The pull was flagged as uses post_content but no body subtree is marked.',
		);
	}
	onEvent({
		kind: 'step',
		message: `Loaded design/${pull.slug}/code.tsx (${code.length} bytes)`,
	});

	// Gather context. The agent could Read these itself but
	// pre-stuffing keeps the run to a small number of turns and the
	// SDK's prompt cache keeps sibling pulls cheap.
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
		onEvent({
			kind: 'warn',
			message: 'No theme.json found — proceeding without it',
		});
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

	const themePath = resolve(
		loaded.dir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
	);
	const existingVariations = await readBlockStyleVariations(themePath, msg =>
		onEvent({kind: 'warn', message: msg}),
	);
	const variationsContext =
		formatBlockStyleVariationsContext(existingVariations);
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
			variationsContext,
		);
	}
	if (patternsContext) {
		baseSections.push('', '=== registered patterns ===', patternsContext);
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
	const assetMappings = formatAssetMappingsContext(
		pull.assets,
		pull.discardedAssets,
	);
	if (assetMappings) {
		baseSections.push('', '=== media library mappings ===', assetMappings);
		const mapped = pull.assets?.length ?? 0;
		const discarded = pull.discardedAssets?.length ?? 0;
		const parts: string[] = [];
		if (mapped > 0) parts.push(`${mapped} mapped`);
		if (discarded > 0) parts.push(`${discarded} discarded`);
		onEvent({
			kind: 'step',
			message: `Loaded media library context: ${parts.join(', ')}`,
		});
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

	const userContent = buildUserContent({
		baseContext,
		screenshotBase64,
		postType,
		pageSlug,
		pageName,
	});

	onEvent({
		kind: 'step',
		message: 'Invoking agent (persists to site via Haydi)…',
	});

	const finalText = await agentRunner(
		userContent,
		{
			cwd: loaded.dir,
			pluginPath: PLUGIN_PATH,
			signal,
			mcpServers: haydiMcpServers(haydi),
			// Whitelist: read-side host tools so the agent can inspect
			// sibling templates if needed, plus the Haydi tool surface
			// the pull-writer recipes use. Task stays disallowed (default).
			allowedTools: ['Read', 'Glob', 'Grep', ...HAYDI_TOOL_ALLOWLIST],
			// Pre-stuffed context + one write call usually completes in
			// ~3 turns; widen the cap to absorb a slow first-token or a
			// retry without aborting a paid run mid-way.
			maxTurns: 20,
		},
		onEvent,
	);

	// Post-flight: confirm the post landed and capture the size. If
	// the agent claimed success but didn't write, this fails loud here
	// instead of leaving the UI lying about it.
	const writtenSize = await verifyPost(haydi, postType, pageSlug, signal);
	if (writtenSize === null) {
		throw new Error(
			`Agent finished but no ${label} post was found via Haydi. The conversion likely failed silently — inspect the Haydi audit log on the site.\n\nAgent's final message (first 500 chars): ${finalText.slice(0, 500)}`,
		);
	}
	if (writtenSize === 0) {
		throw new Error(
			`Agent finished but ${label} has empty post_content. Treat as a failed build; rerun.\n\nAgent's final message (first 500 chars): ${finalText.slice(0, 500)}`,
		);
	}

	onEvent({kind: 'success', message: `Wrote ${writtenSize} bytes to ${label}`});
	return {path: label, size: writtenSize};
}

type UserContent = Array<TextBlock | ImageBlock>;

function buildUserContent(args: {
	baseContext: string;
	screenshotBase64: string | null;
	postType: PagePostType;
	pageSlug: string;
	pageName: string;
}): UserContent {
	const {baseContext, screenshotBase64, postType, pageSlug, pageName} = args;
	const content: UserContent = [];

	const instructions =
		`Use the tsx-to-blocks skill (SCOPE: POST-CONTENT-BODY) to convert the post-content subtree of the code.tsx below into raw Gutenberg block markup. Then use the pull-writer skill to persist that markup to the running site via Haydi MCP.\n\n` +
		`Target wp_post:\n` +
		`  postType = ${postType}\n` +
		`  slug     = ${pageSlug}\n` +
		`  title    = ${JSON.stringify(pageName)}\n\n` +
		`Use Recipe 4 (Page / post write) from pull-writer with these values. Bind the converted markup to the $content variable inside your run_php snippet — do NOT string-interpolate it. Always kses_remove_filters() before wp_insert_post / wp_update_post.\n\n` +
		`When done, report a single terse summary line of the form: "wrote ${postType}:${pageSlug} (id <N>, <N> bytes)". No other commentary.`;

	content.push({type: 'text', text: instructions});

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

// Direct Haydi call: fetch the post by slug, return its
// post_content length. Bypasses the agent entirely so a hallucinated
// "all done" claim from the agent doesn't escape verification.
//
// haydi_run_php surfaces ECHOED output, not `return` values — see the
// note in pull-writer/SKILL.md. We echo a JSON envelope and parse it
// here so the absent-post case is distinguishable from a present-but-
// empty case.
async function verifyPost(
	haydi: HaydiConfig,
	postType: PagePostType,
	slug: string,
	signal: AbortSignal,
): Promise<number | null> {
	// slug + postType are validated above against PAGE_SLUG_RE and the
	// 'page' | 'post' literal, so direct interpolation is safe.
	const phpCode =
		`$post = get_page_by_path('${slug}', OBJECT, '${postType}');` +
		`echo json_encode($post ? ['found' => true, 'bytes' => strlen($post->post_content)] : ['found' => false]);`;
	const result = await runPhp(
		haydi,
		phpCode,
		`Neptune post-flight verification for ${postType}:${slug}`,
		signal,
	);
	if (
		typeof result === 'object' &&
		result !== null &&
		(result as {found?: unknown}).found === true &&
		typeof (result as {bytes?: unknown}).bytes === 'number'
	) {
		return (result as {bytes: number}).bytes;
	}
	return null;
}
