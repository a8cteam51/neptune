// Shared core for the Import Claude Design flow. Ingests a Claude Design
// package into the active theme, standardizes + fact-checks it, installs
// the templates/parts into WordPress, and synthesizes the refine targets
// the existing visual-diff loop consumes. The UI shell lives in
// commands/import-claude-design.tsx; this module owns no React.
//
// Pipeline: validate → copy into theme → standardize (paid agent,
// auto-apply) → enqueue assets → [Studio session: import assets,
// validate + write each template/part to the DB, seed query loops, flush]
// → render static references into synthetic pulls.
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {writeFileAtomic} from '../../lib/atomic-write.js';
import {
	readBlockStyleVariations,
	flushThemeJsonCache,
} from '../../lib/theme-json-patch.js';
import {writeTemplate} from '../../lib/wp-templates.js';
import {ensureQueryLoopPosts} from '../../lib/wp-query-loop.js';
import {openStudioSession, validateBlocks} from '../studio/mcp.js';
import {runAgent} from '../../lib/agent-stream.js';
import {
	captureAtSize,
	ensureBrowserAvailable,
} from '../../lib/browser-capture.js';
import type {LogEvent} from '../../lib/event-list.js';
import type {Loaded} from '../../commands/setup-project/types.js';
import {markClaudeDesignImported} from '../../commands/setup-project/config.js';
import type {LayoutWidths} from '../../commands/build-theme-json.js';
import {
	DESIGN_CSS_REL,
	targetFor,
	validateClaudeDesignDir,
	type ClaudeDesignManifest,
} from './contract.js';
import {ingestPackage} from './ingest.js';
import {runStandardize} from './standardize.js';
import {applyEnqueue, extractHeadBits, type HeadBits} from './enqueue.js';
import {importThemeAssets} from './asset-import.js';
import {
	writeSyntheticPulls,
	type SyntheticPullSummary,
} from './synthetic-pulls.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
// dist/integrations/claude-design/import.js → ../../../plugins/neptune-tools
const PLUGIN_PATH = resolve(
	moduleDir,
	'..',
	'..',
	'..',
	'plugins',
	'neptune-tools',
);

export type ImportDeps = {
	runAgent?: typeof runAgent;
	captureAtSize?: typeof captureAtSize;
};

export type ImportResult = {
	templatesInstalled: number;
	partsInstalled: number;
	variationsWritten: number;
	residualWritten: boolean;
	reclassifiedCount: number;
	keptCount: number;
	invalidBlockFiles: string[];
	refineTargets: SyntheticPullSummary[];
	warnings: string[];
};

export async function runImport(
	loaded: Loaded,
	sourceDir: string,
	widths: LayoutWidths,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: ImportDeps = {},
): Promise<ImportResult> {
	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error(
			'themeSlug missing from neptune-config. Run Setup / Load Project and configure a theme first.',
		);
	}
	const warnings: string[] = [];

	// 1. Validate the package.
	onEvent({
		kind: 'step',
		message: `Validating Claude Design package at ${sourceDir}`,
	});
	const validation = await validateClaudeDesignDir(sourceDir);
	for (const w of validation.warnings) {
		warnings.push(w);
		onEvent({kind: 'warn', message: w});
	}
	if (!validation.ok || !validation.manifest) {
		throw new Error(
			`Package is not valid:\n- ${validation.errors.join('\n- ')}`,
		);
	}
	const manifest = validation.manifest;
	onEvent({
		kind: 'success',
		message: `Package OK: ${manifest.templates.length} template(s), ${manifest.parts.length} part(s), ${Object.keys(manifest.staticRefs).length} static reference(s).`,
	});

	// Pre-flight: the refine-target render at the very end needs a
	// Playwright browser. Check it NOW — before the paid standardize agent
	// call — so a missing/outdated browser binary fails fast with an
	// actionable message instead of wasting the agent run and silently
	// producing no refine targets. Only when there are static references to
	// render (otherwise no capture happens and the browser isn't needed).
	if (Object.keys(manifest.staticRefs).length > 0) {
		onEvent({kind: 'step', message: 'Checking Playwright browser…'});
		await ensureBrowserAvailable(signal);
		onEvent({kind: 'success', message: 'Playwright browser ready.'});
	}

	// Flip the project onto the Claude Design pipeline up front, so a
	// failure partway through still leaves a coherent claude-design
	// project the user can re-import (rather than a figma/claude-design
	// hybrid). Persisted to disk; subsequent steps read dir/themeSlug,
	// which this doesn't change.
	await markClaudeDesignImported(loaded, sourceDir);

	const wpRoot = resolve(loaded.dir, 'wordpress');
	const themeDir = resolve(wpRoot, 'wp-content', 'themes', themeSlug);

	// 2. Copy the package into the theme (theme.json widths enforced).
	const {themeJson} = await ingestPackage(manifest, themeDir, widths, onEvent);

	// 3. Standardize + fact-check (paid agent, auto-apply, maximize standards).
	const std = await runStandardize(
		manifest,
		themeDir,
		{cwd: loaded.dir, pluginPath: PLUGIN_PATH, signal},
		onEvent,
		{runAgent: deps.runAgent},
	);

	// 4. Enqueue the design CSS + assets/*.js + fonts via functions.php.
	// The design CSS file exists when the package shipped a style.css (we
	// copied it) or the standardize pass wrote residual CSS to it.
	const headBits = await resolveHeadBits(manifest);
	const designCssRel =
		manifest.styleCssPath || std.residualWritten ? DESIGN_CSS_REL : null;
	await applyEnqueue(
		themeDir,
		manifest.scriptAssets,
		designCssRel,
		headBits,
		onEvent,
	);

	// 5. Studio session: import assets, validate + write each template/part,
	//    seed query loops, flush. One session for the whole batch.
	const invalidBlockFiles: string[] = [];
	let templatesInstalled = 0;
	let partsInstalled = 0;
	const session = await openStudioSession({signal});
	try {
		// Image assets → media library; rewrite references in the markup.
		const markup = await importThemeAssets(
			session,
			wpRoot,
			manifest,
			std.markup,
			onEvent,
		);
		// Persist any asset-rewritten markup back to disk so theme files
		// match the DB.
		for (const [path, html] of Object.entries(markup)) {
			if (html !== std.markup[path]) {
				await writeFileAtomic(join(themeDir, path), html);
			}
		}

		for (const file of manifest.templates) {
			if (signal.aborted) throw new Error('Import aborted');
			const rel = `templates/${file}`;
			const html = markup[rel]!;
			await factCheckBlocks(
				session,
				wpRoot,
				rel,
				html,
				onEvent,
				invalidBlockFiles,
			);
			const target = targetFor('template', file);
			await writeTemplate(session, wpRoot, target, html);
			await ensureQueryLoopPosts(session, wpRoot, html, onEvent);
			templatesInstalled++;
			onEvent({
				kind: 'success',
				message: `Installed wp_template:${target.slug}`,
			});
		}

		for (const file of manifest.parts) {
			if (signal.aborted) throw new Error('Import aborted');
			const rel = `parts/${file}`;
			const html = markup[rel]!;
			await factCheckBlocks(
				session,
				wpRoot,
				rel,
				html,
				onEvent,
				invalidBlockFiles,
			);
			const target = targetFor('part', file);
			await writeTemplate(session, wpRoot, target, html);
			partsInstalled++;
			onEvent({
				kind: 'success',
				message: `Installed wp_template_part:${target.slug}`,
			});
		}

		await flushThemeJsonCache(session, wpRoot);
		onEvent({kind: 'step', message: 'Flushed theme.json cache.'});
	} finally {
		session.close();
	}

	// 6. Synthesize refine targets from the static references.
	const refineTargets = await writeSyntheticPulls(
		loaded,
		manifest,
		themeJson,
		signal,
		onEvent,
		{captureAtSize: deps.captureAtSize},
	);

	// Surface custom templates that have no auto-generated preview page.
	noteCustomTemplates(themeJson, onEvent);

	// Re-read variations only to report the on-disk count after the pass.
	const variations = await readBlockStyleVariations(themeDir);

	return {
		templatesInstalled,
		partsInstalled,
		variationsWritten: variations.length,
		residualWritten: std.residualWritten,
		reclassifiedCount: std.reclassifiedCount,
		keptCount: std.keptCount,
		invalidBlockFiles,
		refineTargets,
		warnings,
	};
}

// Cheaply (re)generates the refine targets — screenshot.png + synthetic
// PullMeta per template — WITHOUT re-running the paid standardize agent or
// re-installing the theme. Used when an import's final render step failed
// (e.g. missing browser) or the user wants to re-render after editing the
// package's static references. Re-reads the recorded package dir, renders
// its static references against the project's wide width, and writes the
// pulls the refine loop consumes. No agent, no DB writes.
export async function runRegenerateRefineTargets(
	loaded: Loaded,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: ImportDeps = {},
): Promise<SyntheticPullSummary[]> {
	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error('themeSlug missing from neptune-config.');
	}
	const sourceDir = loaded.config.claudeDesign?.sourceDir;
	if (!sourceDir) {
		throw new Error(
			'No recorded Claude Design package directory. Run Import Claude Design first.',
		);
	}

	onEvent({kind: 'step', message: `Re-reading package at ${sourceDir}`});
	const validation = await validateClaudeDesignDir(sourceDir);
	if (!validation.ok || !validation.manifest) {
		throw new Error(
			`Package is no longer valid:\n- ${validation.errors.join('\n- ')}`,
		);
	}
	const manifest = validation.manifest;
	if (Object.keys(manifest.staticRefs).length === 0) {
		onEvent({
			kind: 'warn',
			message:
				'Package has no top-level static references; there is nothing to render as a refine target.',
		});
		return [];
	}

	await ensureBrowserAvailable(signal);

	const themeJsonPath = resolve(
		loaded.dir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
		'theme.json',
	);
	let themeJson: unknown = {};
	try {
		themeJson = JSON.parse(await readFile(themeJsonPath, 'utf8'));
	} catch {
		// Width defaults inside writeSyntheticPulls handle a missing/unreadable
		// theme.json; proceed with an empty object.
	}

	return writeSyntheticPulls(loaded, manifest, themeJson, signal, onEvent, {
		captureAtSize: deps.captureAtSize,
	});
}

// Runs block validation on a template/part before writing it. Invalid
// markup is recorded and warned, but we still install it — Claude Design
// markup is hand-authored and usually renders on the front end even when
// the editor flags a deprecation; the refine loop and a human can resolve
// it. (Fact-check = surface, not silently block.)
async function factCheckBlocks(
	session: Awaited<ReturnType<typeof openStudioSession>>,
	wpRoot: string,
	label: string,
	html: string,
	onEvent: (ev: LogEvent) => void,
	invalidBlockFiles: string[],
): Promise<void> {
	try {
		const result = await validateBlocks(session, wpRoot, html);
		if (result.ok) {
			onEvent({
				kind: 'step',
				message: `Blocks valid: ${label} (${result.total})`,
			});
		} else {
			invalidBlockFiles.push(label);
			onEvent({
				kind: 'warn',
				message: `Invalid blocks in ${label} (${result.valid}/${result.total}). Installing anyway; refine/fix in the editor:\n${result.issues}`,
			});
		}
	} catch (err) {
		onEvent({
			kind: 'warn',
			message: `Could not validate ${label}: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
}

// Resolves the web-fonts href + no-flash snippet from the first static
// reference that carries them.
async function resolveHeadBits(
	manifest: ClaudeDesignManifest,
): Promise<HeadBits> {
	let bits: HeadBits = {fontsHref: null, noFlashScript: null};
	for (const ref of Object.values(manifest.staticRefs)) {
		const html = await readFile(ref, 'utf8').catch(() => '');
		if (!html) continue;
		const found = extractHeadBits(html);
		bits = {
			fontsHref: bits.fontsHref ?? found.fontsHref,
			noFlashScript: bits.noFlashScript ?? found.noFlashScript,
		};
		if (bits.fontsHref && bits.noFlashScript) break;
	}
	return bits;
}

// Custom templates (e.g. page-style-guide) need a page that uses them to
// be previewable. Creating + assigning those is out of scope for the
// import; surface them so the user can wire them up in the editor.
function noteCustomTemplates(
	themeJson: unknown,
	onEvent: (ev: LogEvent) => void,
): void {
	if (typeof themeJson !== 'object' || themeJson === null) return;
	const list = (themeJson as Record<string, unknown>)['customTemplates'];
	if (!Array.isArray(list) || list.length === 0) return;
	const names = list
		.map(e =>
			typeof e === 'object' && e !== null
				? (e as Record<string, unknown>)['name']
				: null,
		)
		.filter((n): n is string => typeof n === 'string');
	if (names.length === 0) return;
	onEvent({
		kind: 'step',
		message: `Custom templates registered: ${names.join(', ')}. Assign each to a page in the Site Editor to preview/refine it.`,
	});
}
