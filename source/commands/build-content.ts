// Shared core for the page-content build flow. Feeds one
// usesPostContent pull's design/<slug>/code.tsx (plus theme.json,
// variables/all-variables.json, any existing block style variations,
// dev annotations, the registered-patterns inventory, and the
// per-pull media library mappings — uploaded constName→{id, url}
// plus discarded-SVG constName→description) to the configured agent
// provider with the tsx-to-blocks skill, then writes the resulting
// Gutenberg block markup to the matching wp_post (page) via the
// page-set wp neptune CLI.
//
// Mirrors build-template, but: only sees pulls flagged usesPostContent;
// targets a wp_post (page) via lib/wp-pages.ts; tells the skill to
// convert ONLY the data-neptune-annotations="post-content" subtree.
//
// The UI shell lives in build-contents.tsx — it picks the pulls and
// calls runBuildContent for each. This module owns no React; it's
// pure I/O + agent invocation.
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
	applyBlockStyleVariations,
	applyThemeJsonPatch,
	flushThemeJsonCache,
	formatBlockStyleVariationsContext,
	readBlockStyleVariations,
} from '../lib/theme-json-patch.js';
import {parseBuildEnvelope} from '../lib/build-envelope.js';
import {formatAssetMappingsContext} from '../lib/asset-mappings.js';
import {
	formatRegisteredPatternsContext,
	listRegisteredPatterns,
} from '../lib/patterns.js';
import type {LogEvent} from '../lib/event-list.js';
import {pageTargetFor, pageTargetLabel, writePage} from '../lib/wp-pages.js';
import {openStudioSession} from '../integrations/studio/mcp.js';
import {ensureQueryLoopPosts} from '../lib/wp-query-loop.js';
import type {Loaded} from './setup-project/types.js';
import type {PullMeta} from '../lib/types.js';

export type ContentBuildPull = PullMeta & {pageSlug: string};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = resolve(moduleDir, '..', '..', 'plugins', 'neptune-tools');

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
	const themeSlug = loaded.config.themeSlug!;

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

	const wpRoot = resolve(loaded.dir, 'wordpress');
	const themePath = resolve(wpRoot, 'wp-content', 'themes', themeSlug);
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

	const userContent = buildUserContent(baseContext, screenshotBase64);

	onEvent({kind: 'step', message: 'Invoking Claude agent…'});

	const responseText = await agentRunner(
		userContent,
		{cwd: loaded.dir, pluginPath: PLUGIN_PATH, signal},
		onEvent,
	);

	const envelope = parseBuildEnvelope(responseText, 'build-content');
	const target = pageTargetFor(
		pull.pageSlug,
		pull.pageName,
		pull.postType ?? 'page',
	);
	const out = envelope.template_html.endsWith('\n')
		? envelope.template_html
		: envelope.template_html + '\n';

	const session = await openStudioSession({signal});
	let cacheNeedsFlush = false;
	try {
		await writePage(session, wpRoot, target, out);
		await ensureQueryLoopPosts(session, wpRoot, out, onEvent);
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

	const label = pageTargetLabel(target);
	onEvent({
		kind: 'success',
		message: `Wrote ${out.length} bytes to ${label}`,
	});

	return {path: label, size: out.length};
}

type UserContent = Array<TextBlock | ImageBlock>;

function buildUserContent(
	baseContext: string,
	screenshotBase64: string | null,
): UserContent {
	const content: UserContent = [];

	content.push({
		type: 'text',
		text: `Use the tsx-to-blocks skill. SCOPE: POST-CONTENT-BODY. Apply the rules from the skill's "Scope: POST-CONTENT-BODY" section verbatim.`,
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

	content.push({
		type: 'text',
		text: 'Respond with the JSON envelope ONLY. Begin your reply with `{` and end with `}`. No preamble, no analysis, no commentary, no markdown fences, no trailing summary.',
	});

	return content;
}
