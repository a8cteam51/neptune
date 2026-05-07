// Shared core for the pattern-build flow. Feeds one
// patterns/<Name>/code.tsx (plus theme.json, the variables index, the
// pattern's screenshot, dev annotations, the existing block-style
// variations inventory, and the registered-patterns inventory) to the
// configured agent provider with the tsx-to-pattern skill, then writes the
// resulting block markup as a PHP file at
// <theme>/patterns/<kebab-slug>.php that WordPress core auto-registers
// from the docblock header.
//
// The UI shell lives in build-patterns.tsx — it picks the sources and
// calls runBuildPattern for each. This module owns no React.
import {readFile, stat} from 'node:fs/promises';
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
import type {LogEvent} from '../lib/event-list.js';
import {readIfExists} from '../lib/fs-helpers.js';
import {
	applyBlockStyleVariations,
	applyThemeJsonPatch,
	flushThemeJsonCache,
	formatBlockStyleVariationsContext,
	readBlockStyleVariations,
} from '../lib/theme-json-patch.js';
import {
	formatRegisteredPatternsContext,
	kebabFromPascalCase,
	listRegisteredPatterns,
	parsePatternEnvelope,
	serializePatternPhp,
	writePatternFile,
	type PatternSource,
} from '../lib/patterns.js';
import {placeholderInstructions} from './build-template.js';
import {openStudioSession} from '../integrations/studio/mcp.js';
import type {Loaded} from './setup-project/types.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = resolve(moduleDir, '..', '..', 'plugins', 'neptune-tools');

export type BuildPatternDeps = {
	runAgent?: typeof runAgent;
};

export async function runBuildPattern(
	loaded: Loaded,
	src: PatternSource,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: BuildPatternDeps = {},
): Promise<{slug: string; path: string; size: number}> {
	const agentRunner = deps.runAgent ?? runAgent;
	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error(
			'themeSlug missing from neptune-config — finish theme setup first.',
		);
	}

	onEvent({
		kind: 'step',
		message: `Loaded patterns/${src.name}/code.tsx (${src.body.length} bytes)`,
	});

	const wpRoot = resolve(loaded.dir, 'wordpress');
	const themePath = resolve(wpRoot, 'wp-content', 'themes', themeSlug);
	const themeJsonPath = resolve(themePath, 'theme.json');

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

	// Patterns can reference other registered patterns. Surface the
	// inventory the same way build-template / build-content do so the
	// agent emits `<!-- wp:pattern {"slug":"..."} /-->` for nested
	// references instead of inlining a copy. listRegisteredPatterns
	// reads the theme's PHP files; in a sequential build (e.g. E2E)
	// patterns built earlier in the same run will already be present.
	const registeredPatterns = await listRegisteredPatterns(
		loaded.dir,
		themeSlug,
	);
	const otherPatterns = registeredPatterns.filter(p => p.name !== src.name);
	const patternsContext = formatRegisteredPatternsContext(otherPatterns);
	if (patternsContext) {
		onEvent({
			kind: 'step',
			message: `Loaded ${otherPatterns.length} registered pattern${otherPatterns.length === 1 ? '' : 's'} for reuse context`,
		});
	}

	const sections: string[] = ['=== pattern.tsx ===', src.body];
	if (themeJsonText) {
		sections.push('', '=== theme.json ===', themeJsonText);
	}
	if (variablesText) {
		sections.push('', '=== variables.json ===', variablesText);
	}
	if (variationsContext) {
		sections.push(
			'',
			'=== existing block style variations ===',
			'These variations are already registered. Reuse them by adding the matching `is-style-<slug>` class to a block instead of redefining them. Only emit a new entry in `block_style_variations[]` when none of these fits.',
			variationsContext,
		);
	}
	if (patternsContext) {
		sections.push(
			'',
			'=== registered patterns ===',
			'These block patterns are already registered in the theme. When the TSX invokes a function whose PascalCase name matches one of these `name` entries, emit `<!-- wp:pattern {"slug":"<slug>"} /-->` for that JSX element instead of inlining the function body. Use the `slug` field verbatim. Match is case-sensitive and exact on the function name.',
			patternsContext,
		);
	}
	const devAnnotations = extractDevAnnotations(src.body);
	if (devAnnotations.length > 0) {
		const noteCount = devAnnotations.reduce(
			(sum, a) => sum + a.notes.length,
			0,
		);
		sections.push(
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
		sections.push(
			'',
			'=== placeholder image ===',
			placeholderInstructions(placeholder),
		);
	}
	const baseContext = sections.join('\n');

	const screenshotPath = join(
		loaded.dir,
		'patterns',
		src.name,
		'screenshot.png',
	);
	const screenshotBuf = await readPngIfExists(screenshotPath);
	if (screenshotBuf) {
		onEvent({
			kind: 'step',
			message: `Loaded screenshot.png (${screenshotBuf.length} bytes)`,
		});
	} else {
		onEvent({
			kind: 'warn',
			message: 'No usable screenshot.png — proceeding without visual reference',
		});
	}
	const screenshotBase64 = screenshotBuf
		? screenshotBuf.toString('base64')
		: null;

	const userContent = buildUserContent(src.name, baseContext, screenshotBase64);

	onEvent({kind: 'step', message: 'Invoking configured agent provider…'});

	const responseText = await agentRunner(
		userContent,
		{cwd: loaded.dir, pluginPath: PLUGIN_PATH, signal},
		onEvent,
	);

	const envelope = parsePatternEnvelope(responseText);
	const slug = kebabFromPascalCase(src.name);
	if (!slug) {
		throw new Error(
			`Cannot derive a kebab-case slug from pattern name "${src.name}".`,
		);
	}
	const php = serializePatternPhp({themeSlug, slug, envelope});

	// Write the PHP, the theme.json patch, and the block-style
	// variations together so a failure in any of them doesn't leave a
	// half-built pattern on disk (PHP without theme.json registrations
	// would cache stale styles in WP). Mirrors the sequencing in
	// runBuild / runBuildContent.
	const session = await openStudioSession({signal});
	let path: string;
	let cacheNeedsFlush = false;
	try {
		path = await writePatternFile(themePath, slug, php);
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

	onEvent({
		kind: 'success',
		message: `Wrote ${php.length} bytes to ${path}`,
	});

	return {slug, path, size: php.length};
}

type UserContent = Array<TextBlock | ImageBlock>;

// We rely on the tsx-to-pattern skill to know HOW to convert. The
// lead sentence keeps the trigger words from the skill's description
// so the SDK auto-invokes it; the skill body owns the conversion
// rules. The per-call dynamic context is the pattern's source name —
// the agent uses it as the canonical title fallback when the TSX
// doesn't suggest something better.
function buildUserContent(
	name: string,
	baseContext: string,
	screenshotBase64: string | null,
): UserContent {
	const content: UserContent = [
		{
			type: 'text',
			text:
				`Convert this Figma-extracted React + Tailwind pattern function (named "${name}") into a WordPress block pattern. ` +
				`Use the tsx-to-pattern skill. Treat the supplied TSX as a reusable fragment — patterns are not full pages. ` +
				`Return the JSON envelope described in the skill. Neptune wraps the markup in the PHP file header itself; ` +
				`do NOT emit any \`<?php\` tags or call any tools yourself.`,
		},
	];

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

// Returns null when the screenshot is missing or zero-byte. A zero-byte
// file is "exists" from the filesystem's perspective but not a usable
// PNG, so we treat it the same as missing rather than letting an empty
// buffer reach the agent prompt.
async function readPngIfExists(p: string): Promise<Buffer | null> {
	try {
		const s = await stat(p);
		if (!s.isFile() || s.size === 0) return null;
		return await readFile(p);
	} catch {
		return null;
	}
}
