// Shared core for the template-build flow. Feeds one pull's
// design/<slug>/code.tsx (plus the theme's theme.json,
// variables/all-variables.json, any existing block style variations,
// dev annotations from code.tsx, the registered-patterns inventory,
// and the per-pull media library mappings — uploaded constName→{id,
// url} plus discarded-SVG constName→description) to the agent with the
// tsx-to-blocks + pull-writer skills loaded and a Haydi MCP server
// attached. The agent converts the markup AND persists every artifact
// itself: the wp_template / wp_template_part body via Haydi run_php,
// any theme.json edits via local Edit/Write on the project checkout,
// any block style variation files via local Write, and a cache flush
// via Haydi at the end. The host post-flight-verifies the template
// post and reports the size.
//
// The UI shell lives in build-templates.tsx — it picks the pulls and
// calls runBuild for each. This module owns no React.
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
	formatBlockStyleVariationsContext,
	readBlockStyleVariations,
} from '../lib/theme-json-patch.js';
import {formatAssetMappingsContext} from '../lib/asset-mappings.js';
import {
	formatRegisteredPatternsContext,
	listRegisteredPatterns,
} from '../lib/patterns.js';
import type {LogEvent} from '../lib/event-list.js';
import {templateRole, type TemplateRole} from '../lib/template-scaffold.js';
import {targetLabel, templateTargetFor} from '../lib/wp-templates.js';
import {HAYDI_TOOL_ALLOWLIST, haydiMcpServers} from '../lib/haydi-mcp.js';
import {preflight, readTemplateViaHaydi} from '../integrations/haydi/client.js';
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
	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error(
			'themeSlug missing from neptune-config.json — finish theme setup first.',
		);
	}
	const haydi = loaded.config.haydi;
	if (!haydi) {
		throw new Error(
			'haydi config missing from neptune-config.json. Build template persists the template post + theme.json edits + cache flush via Haydi MCP; add { "haydi": { "url": "...", "token": "..." } } to the project config.',
		);
	}
	onEvent({kind: 'step', message: `Pinging Haydi at ${haydi.url}…`});
	await preflight(haydi, signal);
	onEvent({kind: 'step', message: 'Haydi extensions verified'});

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

	const target = templateTargetFor(pull.templateFile, pull.pageName);
	const userContent = buildUserContent({
		templateFile: pull.templateFile,
		target,
		themeSlug,
		themePath,
		themeJsonPath,
		baseContext,
		screenshotBase64,
		usesPostContent: pull.usesPostContent === true,
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
			allowedTools: [
				'Read',
				'Edit',
				'Write',
				'Glob',
				'Grep',
				...HAYDI_TOOL_ALLOWLIST,
			],
			// Template + theme.json edit + variation files + cache flush
			// is 4–6 tool calls in the steady state; widen the cap to
			// absorb extra reads or a retry without aborting mid-run.
			maxTurns: 30,
		},
		onEvent,
	);

	// Post-flight verification — the agent claims it persisted; read
	// the wp_template post back via Haydi and confirm there's actual
	// markup there. If the agent finished but the post is empty or
	// missing, fail loud now instead of letting the UI lie.
	const persisted = await readTemplateViaHaydi(
		haydi,
		{type: target.type, slug: target.slug},
		signal,
	);
	const label = targetLabel(target);
	if (persisted === null) {
		throw new Error(
			`Agent finished but no ${label} post was found via Haydi. The build likely failed silently — inspect the Haydi audit log on the site.\n\nAgent's final message (first 500 chars): ${finalText.slice(0, 500)}`,
		);
	}
	const size = persisted.length;
	if (size === 0) {
		throw new Error(
			`Agent finished but ${label} has empty post_content. Treat as failed; rerun.\n\nAgent's final message (first 500 chars): ${finalText.slice(0, 500)}`,
		);
	}

	onEvent({kind: 'success', message: `Wrote ${size} bytes to ${label}`});
	return {path: label, size};
}

type UserContent = Array<TextBlock | ImageBlock>;

// We rely on the tsx-to-blocks skill to know HOW to convert, and the
// pull-writer skill for the persistence recipes. The lead text emits
// the dynamic per-call context (template target, theme paths) the
// recipes plug into.
function buildUserContent(args: {
	templateFile: string;
	target: ReturnType<typeof templateTargetFor>;
	themeSlug: string;
	themePath: string;
	themeJsonPath: string;
	baseContext: string;
	screenshotBase64: string | null;
	usesPostContent: boolean;
}): UserContent {
	const role = templateRole(args.templateFile);
	const scope = scopeForTemplate(role, args.usesPostContent);
	const content: UserContent = [];

	const instructions =
		`Use the tsx-to-blocks skill (SCOPE: ${scope}) to convert the code.tsx below into Gutenberg block markup, AND use the pull-writer skill to persist every artifact yourself. Do not return a JSON envelope.\n\n` +
		`Target wp_template:\n` +
		`  type  = ${args.target.type}\n` +
		`  slug  = ${args.target.slug}\n` +
		`  title = ${JSON.stringify(args.target.title)}\n\n` +
		`Theme paths:\n` +
		`  theme.json     = ${args.themeJsonPath}\n` +
		`  variations dir = ${join(args.themePath, 'styles', 'blocks')}\n\n` +
		`Required persistence order (from pull-writer):\n` +
		`  1. Write the block markup via Recipe 2 (Template write). Use $content for the markup, kses_remove_filters(), wp_set_object_terms with get_stylesheet().\n` +
		`  2. If theme.json needs new structured properties (styles.blocks or settings.custom), use Recipe 6 (Read + Write theme.json freeform). Deep-merge into the two allowed subtrees ONLY; preserve everything else byte-for-byte.\n` +
		`  3. If new block style variations are needed, use Recipe 7 (Write one styles/blocks/<slug>.json per variation). Reuse existing variations from the context section first; only register new ones when no existing entry fits. Slug MUST be neptune-prefixed.\n` +
		`  4. If you touched theme.json or any styles/blocks/*.json file, call Recipe 5 (wp_cache_flush) once at the end.\n\n` +
		`Final response: one terse plaintext summary line per artifact written. Examples:\n` +
		`  wrote ${args.target.type}:${args.target.slug} (id <N>, <bytes> bytes)\n` +
		`  edited ${args.themeJsonPath} (extended styles.blocks.core/heading)\n` +
		`  wrote ${join(args.themePath, 'styles', 'blocks')}/<slug>.json\n` +
		`  flushed theme.json cache\n` +
		`No JSON envelope. No markdown fences. No narration.`;

	content.push({type: 'text', text: instructions});

	if (args.screenshotBase64) {
		content.push({
			type: 'text',
			text: '=== screenshot.png — visual reference for the intended design output ===',
		});
		content.push({
			type: 'image',
			source: {
				type: 'base64',
				media_type: 'image/png',
				data: args.screenshotBase64,
			},
		});
	}

	content.push({type: 'text', text: args.baseContext});

	return content;
}

// Maps a template role + post-content flag onto the SCOPE token
// vocabulary the tsx-to-blocks and apply-diff skills both define.
// Keep returns aligned with those skills' "Scope vocabulary" tables.
export function scopeForTemplate(
	role: TemplateRole,
	usesPostContent: boolean,
): 'PAGE' | 'HEADER' | 'FOOTER' | 'WRAPPER' {
	if (role === 'header') return 'HEADER';
	if (role === 'footer') return 'FOOTER';
	return usesPostContent ? 'WRAPPER' : 'PAGE';
}
