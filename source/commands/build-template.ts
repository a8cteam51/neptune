// Shared core for the template-build flow. Feeds one pull's
// design/<slug>/code.tsx (plus the theme's theme.json,
// variables/all-variables.json, any existing block style variations,
// dev annotations from code.tsx, the registered-patterns inventory,
// and the per-pull media library mappings — uploaded constName→{id,
// url} plus discarded-SVG constName→description) to the configured
// agent provider with the tsx-to-blocks skill, then writes the
// resulting Gutenberg block markup to the pull's wp_template /
// wp_template_part post in the WordPress database via Studio's
// wp-cli. The envelope's theme_json_patch deep-merges into theme.json
// and block_style_variations[] write to <theme>/styles/blocks/*.json.
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
import {formatAssetMappingsContext} from '../lib/asset-mappings.js';
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

	const userContent = buildUserContent(
		pull.templateFile,
		baseContext,
		screenshotBase64,
		pull.usesPostContent === true,
	);

	onEvent({kind: 'step', message: 'Invoking configured agent provider…'});

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
// sentence dispatches via a SCOPE token whose rules the skill owns
// verbatim — see the skill's "Scope vocabulary" + "Per-scope rules"
// sections. The .ts side only emits the dynamic per-call context
// (template name, scope token).
function buildUserContent(
	templateFile: string,
	baseContext: string,
	screenshotBase64: string | null,
	usesPostContent: boolean,
): UserContent {
	const role = templateRole(templateFile);
	const scope = scopeForTemplate(role, usesPostContent);
	const content: UserContent = [];

	content.push({
		type: 'text',
		text: `Use the tsx-to-blocks skill. SCOPE: ${scope}. Template file: ${templateFile}. Apply the rules from the skill's "Scope: ${scope}" section verbatim.`,
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
