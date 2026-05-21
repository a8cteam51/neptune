// Runner for the build-content end-to-end smoke test against a real
// Haydi-equipped Studio site. Intended to be invoked once during the
// migration off the JSON envelope: it loads a fixture project,
// triggers runBuildContent, prints events, and reports the resulting
// wp_post size.
//
// Usage:
//   PROJECT_DIR=/tmp/neptune-smoke-build-content \
//     npx tsx scripts/smoke-build-content.ts
//
// PROJECT_DIR must contain a neptune-config.json with a haydi block
// and a design/smoke-test/ pull. The site referenced by the haydi
// config must be running and have haydi-full-extensions active.
import {loadOrInit} from '../source/commands/setup-project/config.js';
import {runBuildContent} from '../source/commands/build-content.js';

const projectDir = process.env['PROJECT_DIR'];
if (!projectDir) {
	console.error('PROJECT_DIR env var is required.');
	process.exit(2);
}

const loaded = await loadOrInit(projectDir);

const pull = {
	pageName: 'Neptune Smoke Test',
	slug: 'smoke-test',
	pageSlug: 'neptune-smoke-test-20260521-152612',
	postType: 'page' as const,
	usesPostContent: true,
	pulledAt: '2026-05-21T15:26:00.000Z',
};

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());

const t0 = Date.now();
try {
	const result = await runBuildContent(loaded, pull, controller.signal, ev => {
		const stamp = `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
		const tag = ev.kind === 'warn' ? 'WARN' : ev.kind.toUpperCase();
		console.log(`${stamp} ${tag} ${ev.message}`);
	});
	console.log(`\nDONE: wrote ${result.size} bytes to ${result.path}`);
} catch (err) {
	console.error(
		`\nFAILED: ${err instanceof Error ? err.message : String(err)}`,
	);
	process.exit(1);
}
