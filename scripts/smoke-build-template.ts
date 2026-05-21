// Runner for the build-template end-to-end smoke test against a real
// Haydi-equipped Studio site. Uses the same fixture as
// smoke-build-content but a different design pull aimed at a template
// rather than a page body.
//
// Usage:
//   PROJECT_DIR=/tmp/neptune-smoke-build-template \
//     npx tsx scripts/smoke-build-template.ts
//
// PROJECT_DIR must contain a neptune-config.json with a haydi block
// and a design/<slug>/ pull whose templateFile is set. The site
// referenced by the haydi config must be running and have
// haydi-full-extensions active.
import {loadOrInit} from '../source/commands/setup-project/config.js';
import {runBuild} from '../source/commands/build-template.js';
import {
	readTemplateViaHaydi,
	runPhp,
} from '../source/integrations/haydi/client.js';

const projectDir = process.env['PROJECT_DIR'];
if (!projectDir) {
	console.error('PROJECT_DIR env var is required.');
	process.exit(2);
}

const loaded = await loadOrInit(projectDir);
const haydi = loaded.config.haydi;
if (!haydi) {
	console.error('haydi config missing from neptune-config.json.');
	process.exit(2);
}

const pull = {
	pageName: 'Neptune Template Smoke',
	slug: 'template-smoke',
	templateFile: 'index.html',
	pulledAt: '2026-05-21T16:00:00.000Z',
};

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());

const t0 = Date.now();
try {
	const result = await runBuild(loaded, pull, controller.signal, ev => {
		const stamp = `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
		const tag = ev.kind === 'warn' ? 'WARN' : ev.kind.toUpperCase();
		console.log(`${stamp} ${tag} ${ev.message}`);
	});
	console.log(`\nDONE: wrote ${result.size} bytes to ${result.path}`);

	// Confirm we can read it back + the wp_theme term is bound. The
	// slug derives from templateFile ('index.html' → 'index').
	const content = await readTemplateViaHaydi(haydi, {
		type: 'wp_template',
		slug: 'index',
	});
	if (content !== null) {
		console.log(`Round-trip read: ${content.length} bytes`);
	}
	const termCheck = await runPhp(
		haydi,
		`$posts = get_posts(['post_type'=>'wp_template','post_status'=>'publish','name'=>'index','numberposts'=>1,'tax_query'=>[['taxonomy'=>'wp_theme','field'=>'name','terms'=>get_stylesheet()]]]); $p = $posts[0] ?? null; if(!$p){echo json_encode(null); return;} $terms = wp_get_object_terms($p->ID,'wp_theme',['fields'=>'names']); echo json_encode(['id'=>$p->ID,'terms'=>$terms,'bytes'=>strlen($p->post_content)]);`,
		'smoke: verify wp_template:index + wp_theme term',
	);
	console.log(`Verification:`, JSON.stringify(termCheck));
} catch (err) {
	console.error(
		`\nFAILED: ${err instanceof Error ? err.message : String(err)}`,
	);
	process.exit(1);
}
