// Shared core for the pattern-build flow. Feeds one
// patterns/<Name>/code.tsx (plus theme.json, the variables index, the
// pattern's screenshot, dev annotations, the existing block-style
// variations inventory, and the registered-patterns inventory) to the
// agent with the tsx-to-pattern + pull-writer skills loaded and a
// Haydi MCP server attached. The agent computes the pattern metadata,
// assembles the PHP file (docblock + block markup body) AND writes
// it itself via the Write tool. theme.json edits + variation files +
// cache flush flow through the same pull-writer recipes the other
// builds use. The host post-flight reads the PHP file back and
// validates the docblock header.
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
	formatBlockStyleVariationsContext,
	readBlockStyleVariations,
} from '../lib/theme-json-patch.js';
import {HAYDI_TOOL_ALLOWLIST, haydiMcpServers} from '../lib/haydi-mcp.js';
import {preflight} from '../integrations/haydi/client.js';
import {
	formatRegisteredPatternsContext,
	kebabFromPascalCase,
	listRegisteredPatterns,
	type PatternSource,
} from '../lib/patterns.js';
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
	const haydi = loaded.config.haydi;
	if (!haydi) {
		throw new Error(
			'haydi config missing from neptune-config.json. Build pattern persists via Haydi MCP (cache flush) and writes the pattern PHP file via the local Write tool. Add { "haydi": { "url": "...", "token": "..." } } to the project config.',
		);
	}
	onEvent({kind: 'step', message: `Pinging Haydi at ${haydi.url}…`});
	await preflight(haydi, signal);
	onEvent({kind: 'step', message: 'Haydi extensions verified'});

	const slug = kebabFromPascalCase(src.name);
	if (!slug) {
		throw new Error(
			`Cannot derive a kebab-case slug from pattern name "${src.name}".`,
		);
	}

	onEvent({
		kind: 'step',
		message: `Loaded patterns/${src.name}/code.tsx (${src.body.length} bytes)`,
	});

	const wpRoot = resolve(loaded.dir, 'wordpress');
	const themePath = resolve(wpRoot, 'wp-content', 'themes', themeSlug);
	const themeJsonPath = resolve(themePath, 'theme.json');
	const patternPath = resolve(themePath, 'patterns', `${slug}.php`);

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
			'These variations are already registered. Reuse them by adding the matching `is-style-<slug>` class to a block instead of redefining them. Only register a NEW variation file when none of these fits.',
			variationsContext,
		);
	}
	if (patternsContext) {
		sections.push(
			'',
			'=== registered patterns ===',
			'These block patterns are already registered in the theme. When the TSX invokes a function whose PascalCase name matches one of these `name` entries, emit `<!-- wp:pattern {"slug":"<slug>"} /-->` for that JSX element instead of inlining the function body.',
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

	const userContent = buildUserContent({
		name: src.name,
		slug,
		themeSlug,
		patternPath,
		themePath,
		themeJsonPath,
		baseContext,
		screenshotBase64,
	});

	onEvent({
		kind: 'step',
		message: 'Invoking agent (writes pattern PHP via Haydi-aware tools)…',
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
			maxTurns: 30,
		},
		onEvent,
	);

	// Post-flight: stat + read the pattern PHP back, verify the
	// docblock header is what WP needs. If the agent claimed success
	// but didn't write, fail loud here.
	let written: string;
	try {
		written = await readFile(patternPath, 'utf8');
	} catch (err) {
		throw new Error(
			`Agent finished but no pattern file at ${patternPath}: ${err instanceof Error ? err.message : String(err)}\n\nAgent's final message (first 500 chars): ${finalText.slice(0, 500)}`,
		);
	}
	if (!written.startsWith('<?php')) {
		throw new Error(
			`Agent wrote ${patternPath} but it does not begin with <?php. WP can't register this pattern.\n\nFirst 200 chars: ${written.slice(0, 200)}`,
		);
	}
	if (!/^\s*\*\s*Title:/m.test(written)) {
		throw new Error(
			`Agent wrote ${patternPath} but the docblock has no "Title:" header. WP requires it for registration.\n\nFirst 500 chars: ${written.slice(0, 500)}`,
		);
	}
	if (!/^\s*\*\s*Slug:\s*\S+\/\S+/m.test(written)) {
		throw new Error(
			`Agent wrote ${patternPath} but the docblock has no "Slug: <theme>/<pattern>" header. WP requires it for registration.\n\nFirst 500 chars: ${written.slice(0, 500)}`,
		);
	}

	onEvent({
		kind: 'success',
		message: `Wrote ${written.length} bytes to ${patternPath}`,
	});

	return {slug, path: patternPath, size: written.length};
}

type UserContent = Array<TextBlock | ImageBlock>;

function buildUserContent(args: {
	name: string;
	slug: string;
	themeSlug: string;
	patternPath: string;
	themePath: string;
	themeJsonPath: string;
	baseContext: string;
	screenshotBase64: string | null;
}): UserContent {
	const content: UserContent = [];

	const instructions =
		`Convert this Figma-extracted React + Tailwind pattern function (named "${args.name}") into a WordPress block pattern, AND persist it yourself. Use the tsx-to-pattern skill for the conversion rules and the pull-writer skill for the persistence recipes. Patterns are reusable fragments, not full pages.\n\n` +
		`Target:\n` +
		`  Pattern function name = ${args.name}\n` +
		`  Pattern slug          = ${args.slug}\n` +
		`  Theme slug            = ${args.themeSlug}\n` +
		`  Pattern PHP file      = ${args.patternPath}\n\n` +
		`Theme paths (for theme.json or variation edits if needed):\n` +
		`  theme.json     = ${args.themeJsonPath}\n` +
		`  variations dir = ${join(args.themePath, 'styles', 'blocks')}\n\n` +
		`Persistence order:\n` +
		`  1. Write the pattern PHP file via the Write tool. The file MUST begin with <?php and contain a docblock that includes at minimum "Title: <title>" and "Slug: ${args.themeSlug}/${args.slug}" — followed by ?> and then the block markup body. See the skill's "Persistence flow" section for the exact format.\n` +
		`  2. If a structured-property registration is genuinely needed, apply Recipe 6 (theme.json Read + Write) to extend styles.blocks or settings.custom.\n` +
		`  3. If a new block style variation is needed, apply Recipe 7 (Write one styles/blocks/<slug>.json file). Reuse existing variations from the inventory first.\n` +
		`  4. If you touched theme.json or any variation file, call Recipe 5 (wp_cache_flush) ONCE at the end via mcp__haydi__haydi_run_php.\n\n` +
		`Final response: one terse plaintext summary line per artifact written. Example:\n` +
		`  wrote ${args.patternPath} (1234 bytes)\n` +
		`  edited ${args.themeJsonPath} (extended styles.blocks.core/heading)\n` +
		`  wrote ${join(args.themePath, 'styles', 'blocks')}/neptune-callout.json\n` +
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
