// Smoke-test for the host-side ensure* helpers. Calls
// ensurePageViaHaydi + ensureTemplateViaHaydi against a real site,
// asserts idempotency, then cleans up.
//
// Usage:
//   PROJECT_DIR=/tmp/neptune-smoke-build-content \
//     npx tsx scripts/smoke-ensure-via-haydi.ts
import {loadOrInit} from '../source/commands/setup-project/config.js';
import {
	ensurePageViaHaydi,
	ensureTemplateViaHaydi,
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

const tag = `neptune-ensure-smoke-${Date.now()}`;

console.log(`Test slug: ${tag}\n`);

// 1. Page ensure — first call creates, second call finds.
console.log('ensurePageViaHaydi (insert)…');
const page1 = await ensurePageViaHaydi(haydi, {
	postType: 'page',
	slug: tag,
	title: 'Neptune ensure smoke',
});
console.log(`  → created=${page1.created}, id=${page1.id}`);

console.log('ensurePageViaHaydi (idempotent)…');
const page2 = await ensurePageViaHaydi(haydi, {
	postType: 'page',
	slug: tag,
	title: 'Neptune ensure smoke',
});
console.log(`  → created=${page2.created}, id=${page2.id}`);

if (
	page1.created !== true ||
	page2.created !== false ||
	page1.id !== page2.id
) {
	console.error('FAIL: page ensure not idempotent.');
	process.exit(1);
}

// 2. Template ensure — first call creates, second finds.
console.log('\nensureTemplateViaHaydi (insert)…');
const tpl1 = await ensureTemplateViaHaydi(haydi, {
	type: 'wp_template',
	slug: tag,
	title: 'Neptune ensure smoke',
});
console.log(`  → created=${tpl1.created}, id=${tpl1.id}`);

console.log('ensureTemplateViaHaydi (idempotent)…');
const tpl2 = await ensureTemplateViaHaydi(haydi, {
	type: 'wp_template',
	slug: tag,
	title: 'Neptune ensure smoke',
});
console.log(`  → created=${tpl2.created}, id=${tpl2.id}`);

if (tpl1.created !== true || tpl2.created !== false || tpl1.id !== tpl2.id) {
	console.error('FAIL: template ensure not idempotent.');
	process.exit(1);
}

// 3. Verify the template has the wp_theme term bound.
const termCheck = await runPhp(
	haydi,
	`$terms = wp_get_object_terms(${tpl1.id}, 'wp_theme', ['fields' => 'names']); echo json_encode(['terms' => $terms]);`,
	'verify wp_theme term binding',
);
const stylesheetResult = await runPhp(
	haydi,
	`echo json_encode(['stylesheet' => get_stylesheet()]);`,
	'fetch active theme slug',
);
const expectedTheme = (stylesheetResult as {stylesheet: string}).stylesheet;
const terms = (termCheck as {terms: string[]}).terms;
if (!terms.includes(expectedTheme)) {
	console.error(
		`FAIL: template ${tpl1.id} missing wp_theme term ${expectedTheme}. Got: ${JSON.stringify(terms)}`,
	);
	process.exit(1);
}
console.log(`  ✓ wp_theme term bound: ${expectedTheme}`);

// Clean up.
console.log('\nCleaning up…');
await runPhp(
	haydi,
	`wp_delete_post(${page1.id}, true); wp_delete_post(${tpl1.id}, true); echo 'cleaned';`,
	'delete smoke artifacts',
);

console.log('\nDONE — both ensure helpers work and are idempotent.');
