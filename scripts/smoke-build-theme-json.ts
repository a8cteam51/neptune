// Runner for the build-theme-json end-to-end smoke test against a real
// Haydi-equipped Studio site.
//
// Usage:
//   PROJECT_DIR=/tmp/neptune-smoke-build-theme-json \
//     npx tsx scripts/smoke-build-theme-json.ts
//
// PROJECT_DIR must contain a neptune-config.json (with themeSlug +
// haydi block) and a design/<slug>/ pull with variables.json. The
// site referenced by the haydi config must be running and have
// haydi-full-extensions active.
import {readFile} from 'node:fs/promises';
import {loadOrInit} from '../source/commands/setup-project/config.js';
import {buildThemeJson} from '../source/commands/build-theme-json.js';

const projectDir = process.env['PROJECT_DIR'];
if (!projectDir) {
	console.error('PROJECT_DIR env var is required.');
	process.exit(2);
}

const loaded = await loadOrInit(projectDir);

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());

const t0 = Date.now();
try {
	const result = await buildThemeJson(loaded, controller.signal, ev => {
		const stamp = `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
		const tag = ev.kind === 'warn' ? 'WARN' : ev.kind.toUpperCase();
		console.log(`${stamp} ${tag} ${ev.message}`);
	});
	console.log(`\nDONE: wrote ${result.size} bytes to ${result.path}`);

	const content = await readFile(result.path, 'utf8');
	const parsed = JSON.parse(content);
	console.log(`Schema: ${parsed.$schema ?? '(unset)'}`);
	console.log(`Version: ${parsed.version}`);
	console.log(`Top-level keys: ${Object.keys(parsed).join(', ')}`);
	console.log(
		`Palette entries: ${parsed.settings?.color?.palette?.length ?? 0}`,
	);
	console.log(
		`Font sizes: ${parsed.settings?.typography?.fontSizes?.length ?? 0}`,
	);
	console.log(
		`Spacing sizes: ${parsed.settings?.spacing?.spacingSizes?.length ?? 0}`,
	);
} catch (err) {
	console.error(
		`\nFAILED: ${err instanceof Error ? err.message : String(err)}`,
	);
	process.exit(1);
}
