// Direct Haydi MCP client for host-side verification calls. The agent
// uses Haydi through the SDK's MCP transport; this module is for the
// host itself — pre-flight ("are the extensions present?") and
// post-flight ("did the post we asked the agent to write actually land,
// and what size is it now?") checks. Bypasses the agent entirely.
//
// JSON-RPC 2.0 over HTTP. POST /wp-json/haydi/v1/mcp with a Bearer
// header. Each tool call comes back wrapped in MCP's content-block
// array; we extract the single text block and parse it as JSON when
// that's what the tool produces.
import type {HaydiConfig} from '../../commands/setup-project/types.js';

type JsonRpcResponse = {
	jsonrpc: '2.0';
	id: number | string;
	result?: unknown;
	error?: {code: number; message: string};
};

let requestId = 0;

async function jsonRpc(
	config: HaydiConfig,
	method: string,
	params: unknown,
	signal?: AbortSignal,
): Promise<JsonRpcResponse> {
	if (!config.token) {
		throw new Error(
			'Haydi token is missing from neptune-config.json. Paste the Bearer token from WP Admin → Haydi → Remote Access into the haydi.token field.',
		);
	}
	const url = `${config.url}/wp-json/haydi/v1/mcp`;
	const res = await fetch(url, {
		method: 'POST',
		signal,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${config.token}`,
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: ++requestId,
			method,
			params,
		}),
	});
	if (!res.ok) {
		throw new Error(
			`Haydi ${method} → HTTP ${res.status} ${res.statusText} (${url})`,
		);
	}
	return (await res.json()) as JsonRpcResponse;
}

function extractText(resp: JsonRpcResponse, method: string): string {
	if (resp.error) {
		throw new Error(`Haydi ${method} error: ${resp.error.message}`);
	}
	const result = resp.result;
	if (typeof result !== 'object' || result === null) {
		throw new Error(`Haydi ${method} returned no result.`);
	}
	const content = (result as {content?: unknown}).content;
	if (!Array.isArray(content) || content.length === 0) {
		throw new Error(`Haydi ${method} returned no content blocks.`);
	}
	const first = content[0] as {type?: string; text?: string};
	if (first.type !== 'text' || typeof first.text !== 'string') {
		throw new Error(`Haydi ${method} returned non-text content block.`);
	}
	return first.text;
}

// Lightweight smoke check: confirms the URL is reachable, the Bearer
// token is accepted, and the Haydi extensions Neptune relies on are
// active. Throws with a specific actionable message on each failure.
export async function preflight(
	config: HaydiConfig,
	signal?: AbortSignal,
): Promise<void> {
	if (!config.token) {
		throw new Error(
			'Haydi token is missing from neptune-config.json. Paste the Bearer token from WP Admin → Haydi → Remote Access into the haydi.token field.',
		);
	}
	const url = `${config.url}/wp-json/haydi/v1/status`;
	const res = await fetch(url, {
		signal,
		headers: {Authorization: `Bearer ${config.token}`},
	});
	if (res.status === 401 || res.status === 403) {
		throw new Error(
			`Haydi auth failed at ${url} (HTTP ${res.status}). The Bearer token in neptune-config.json is missing or invalid; regenerate in WP Admin → Haydi → Remote Access.`,
		);
	}
	if (!res.ok) {
		throw new Error(
			`Haydi status check failed at ${url}: HTTP ${res.status} ${res.statusText}.`,
		);
	}

	const tools = await jsonRpc(config, 'tools/list', {}, signal);
	if (tools.error) {
		throw new Error(`Haydi tools/list error: ${tools.error.message}`);
	}
	const names = new Set(
		((tools.result as {tools?: Array<{name?: string}>})?.tools ?? [])
			.map(t => t.name)
			.filter((n): n is string => typeof n === 'string'),
	);
	const required = ['haydi_run_php', 'haydi_run_query'];
	const missing = required.filter(n => !names.has(n));
	if (missing.length > 0) {
		throw new Error(
			`Haydi extensions missing required tools: ${missing.join(', ')}. Install haydi-full-extensions.zip on the site and reload Haydi.`,
		);
	}
}

// Run a PHP snippet against the site via Haydi's run_php tool. The
// snippet should `echo` a value (run_php surfaces STDOUT, not return
// values); we parse the echoed text as JSON when possible. Used for
// host-driven mutations + post-write verification — the agent-side
// path uses the same Haydi tool but with the pull-writer recipes
// embedded in the prompt.
export async function runPhp(
	config: HaydiConfig,
	code: string,
	reason: string,
	signal?: AbortSignal,
): Promise<unknown> {
	const resp = await jsonRpc(
		config,
		'tools/call',
		{
			name: 'haydi_run_php',
			arguments: {code, reason},
		},
		signal,
	);
	const text = extractText(resp, 'haydi_run_php');
	// run_php surfaces the snippet's STDOUT (echo), not its return value.
	// "(no output)" is Haydi's sentinel for "the snippet didn't echo
	// anything" — distinct from echoed empty string. Callers expecting a
	// value from a `return` statement need to know about this asymmetry,
	// so we surface the sentinel as a typed null rather than the string.
	if (text === '(no output)') return null;
	try {
		return JSON.parse(text);
	} catch {
		// Snippet echoed something that isn't valid JSON. Surface as-is.
		return text;
	}
}

// Slug regex shared by template + page ensures. Templates were
// historically stricter ([a-z][a-z0-9-]*) but the page regex
// ([a-z0-9][a-z0-9_-]*) is a superset that still rejects anything
// dangerous to interpolate into a PHP literal. Use the broader one so
// canonical slugs like `404` keep working.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

const TEMPLATE_TYPES = ['wp_template', 'wp_template_part'] as const;
export type TemplatePostType = (typeof TEMPLATE_TYPES)[number];
export type PagePostType = 'page' | 'post';

export type EnsureTemplateTarget = {
	type: TemplatePostType;
	slug: string;
	title: string;
};

export type EnsurePageTarget = {
	postType: PagePostType;
	slug: string;
	title: string;
};

// Idempotent: insert an empty wp_template / wp_template_part bound to
// the active theme, or return the existing one's id. Mirrors Recipe 2
// (Template write) from pull-writer/SKILL.md verbatim — kses is lifted
// and the wp_theme term is set in the same request, so a partial state
// (post without term) is unreachable.
export async function ensureTemplateViaHaydi(
	config: HaydiConfig,
	target: EnsureTemplateTarget,
	signal?: AbortSignal,
): Promise<{created: boolean; id: number}> {
	if (!TEMPLATE_TYPES.includes(target.type)) {
		throw new Error(
			`ensureTemplateViaHaydi: invalid type "${target.type}" — must be wp_template or wp_template_part.`,
		);
	}
	if (!SLUG_RE.test(target.slug)) {
		throw new Error(
			`ensureTemplateViaHaydi: invalid slug "${target.slug}" — must match ${SLUG_RE}.`,
		);
	}
	const titleB64 = Buffer.from(target.title, 'utf8').toString('base64');
	const code = `
$slug = '${target.slug}';
$type = '${target.type}';
$title = base64_decode('${titleB64}');
kses_remove_filters();
$posts = get_posts([
    'post_type' => $type,
    'post_status' => 'publish',
    'name' => $slug,
    'numberposts' => 1,
    'tax_query' => [[
        'taxonomy' => 'wp_theme',
        'field' => 'name',
        'terms' => get_stylesheet(),
    ]],
]);
$post = $posts[0] ?? null;
if ($post) {
    echo json_encode(['created' => false, 'id' => (int) $post->ID]);
    return;
}
$id = wp_insert_post([
    'post_type' => $type,
    'post_status' => 'publish',
    'post_name' => $slug,
    'post_title' => $title,
    'post_content' => '',
], true);
if (is_wp_error($id)) {
    echo json_encode(['error' => $id->get_error_message()]);
    return;
}
wp_set_object_terms($id, get_stylesheet(), 'wp_theme', false);
echo json_encode(['created' => true, 'id' => (int) $id]);
`;
	const result = await runPhp(
		config,
		code,
		`pull-template: ensure ${target.type}:${target.slug}`,
		signal,
	);
	return parseEnsureResult(result, `${target.type}:${target.slug}`);
}

// Idempotent: insert an empty page or post, or return the existing
// one's id. Mirrors Recipe 4 (Page / post write) from
// pull-writer/SKILL.md. Pages aren't theme-scoped, so no term binding.
export async function ensurePageViaHaydi(
	config: HaydiConfig,
	target: EnsurePageTarget,
	signal?: AbortSignal,
): Promise<{created: boolean; id: number}> {
	if (target.postType !== 'page' && target.postType !== 'post') {
		throw new Error(
			`ensurePageViaHaydi: invalid postType "${target.postType}" — must be page or post.`,
		);
	}
	if (!SLUG_RE.test(target.slug)) {
		throw new Error(
			`ensurePageViaHaydi: invalid slug "${target.slug}" — must match ${SLUG_RE}.`,
		);
	}
	const titleB64 = Buffer.from(target.title, 'utf8').toString('base64');
	const code = `
$slug = '${target.slug}';
$postType = '${target.postType}';
$title = base64_decode('${titleB64}');
kses_remove_filters();
$existing = get_page_by_path($slug, OBJECT, $postType);
if ($existing) {
    echo json_encode(['created' => false, 'id' => (int) $existing->ID]);
    return;
}
$id = wp_insert_post([
    'post_type' => $postType,
    'post_status' => 'publish',
    'post_name' => $slug,
    'post_title' => $title,
    'post_content' => '',
], true);
if (is_wp_error($id)) {
    echo json_encode(['error' => $id->get_error_message()]);
    return;
}
echo json_encode(['created' => true, 'id' => (int) $id]);
`;
	const result = await runPhp(
		config,
		code,
		`pull-template: ensure ${target.postType}:${target.slug}`,
		signal,
	);
	return parseEnsureResult(result, `${target.postType}:${target.slug}`);
}

// Reads a wp_template / wp_template_part post_content for the active
// theme. Returns null when no DB row exists for that (theme, slug).
// Mirrors Recipe 1 (Template read) from pull-writer/SKILL.md.
export async function readTemplateViaHaydi(
	config: HaydiConfig,
	target: {type: TemplatePostType; slug: string},
	signal?: AbortSignal,
): Promise<string | null> {
	if (!TEMPLATE_TYPES.includes(target.type)) {
		throw new Error(
			`readTemplateViaHaydi: invalid type "${target.type}" — must be wp_template or wp_template_part.`,
		);
	}
	if (!SLUG_RE.test(target.slug)) {
		throw new Error(
			`readTemplateViaHaydi: invalid slug "${target.slug}" — must match ${SLUG_RE}.`,
		);
	}
	const code = `
$posts = get_posts([
    'post_type' => '${target.type}',
    'post_status' => 'publish',
    'name' => '${target.slug}',
    'numberposts' => 1,
    'tax_query' => [[
        'taxonomy' => 'wp_theme',
        'field' => 'name',
        'terms' => get_stylesheet(),
    ]],
]);
$post = $posts[0] ?? null;
echo json_encode($post
    ? ['found' => true, 'content' => $post->post_content]
    : ['found' => false]);
`;
	const result = await runPhp(
		config,
		code,
		`Neptune read ${target.type}:${target.slug}`,
		signal,
	);
	if (typeof result === 'object' && result !== null) {
		const obj = result as Record<string, unknown>;
		if (obj['found'] === false) return null;
		if (obj['found'] === true && typeof obj['content'] === 'string') {
			return obj['content'];
		}
	}
	throw new Error(
		`Haydi read ${target.type}:${target.slug} returned unexpected shape: ${JSON.stringify(result)}`,
	);
}

// Inserts or updates the post_content of a wp_template /
// wp_template_part. Idempotent; uses Recipe 2 verbatim (kses lift +
// wp_theme term binding in one request). $title is only honored when
// inserting a new post.
export async function writeTemplateViaHaydi(
	config: HaydiConfig,
	target: EnsureTemplateTarget,
	content: string,
	signal?: AbortSignal,
): Promise<{created: boolean; id: number}> {
	if (!TEMPLATE_TYPES.includes(target.type)) {
		throw new Error(
			`writeTemplateViaHaydi: invalid type "${target.type}" — must be wp_template or wp_template_part.`,
		);
	}
	if (!SLUG_RE.test(target.slug)) {
		throw new Error(
			`writeTemplateViaHaydi: invalid slug "${target.slug}" — must match ${SLUG_RE}.`,
		);
	}
	const titleB64 = Buffer.from(target.title, 'utf8').toString('base64');
	const contentB64 = Buffer.from(content, 'utf8').toString('base64');
	const code = `
$slug = '${target.slug}';
$type = '${target.type}';
$title = base64_decode('${titleB64}');
$content = base64_decode('${contentB64}');
kses_remove_filters();
$posts = get_posts([
    'post_type' => $type,
    'post_status' => 'publish',
    'name' => $slug,
    'numberposts' => 1,
    'tax_query' => [[
        'taxonomy' => 'wp_theme',
        'field' => 'name',
        'terms' => get_stylesheet(),
    ]],
]);
$post = $posts[0] ?? null;
if ($post) {
    $r = wp_update_post(['ID' => $post->ID, 'post_content' => $content], true);
    if (is_wp_error($r)) {
        echo json_encode(['error' => $r->get_error_message()]);
        return;
    }
    echo json_encode(['created' => false, 'id' => (int) $post->ID]);
    return;
}
$id = wp_insert_post([
    'post_type' => $type,
    'post_status' => 'publish',
    'post_name' => $slug,
    'post_title' => $title,
    'post_content' => $content,
], true);
if (is_wp_error($id)) {
    echo json_encode(['error' => $id->get_error_message()]);
    return;
}
wp_set_object_terms($id, get_stylesheet(), 'wp_theme', false);
echo json_encode(['created' => true, 'id' => (int) $id]);
`;
	const result = await runPhp(
		config,
		code,
		`Neptune write ${target.type}:${target.slug} (${content.length} bytes)`,
		signal,
	);
	return parseEnsureResult(result, `${target.type}:${target.slug}`);
}

// Reads a page or post by slug + post-type. Returns null when no row
// exists (e.g. canonical seed posts deleted, fresh site). Mirrors
// Recipe 3 verbatim.
export async function readPageViaHaydi(
	config: HaydiConfig,
	target: {postType: PagePostType; slug: string},
	signal?: AbortSignal,
): Promise<{id: number; content: string} | null> {
	if (target.postType !== 'page' && target.postType !== 'post') {
		throw new Error(
			`readPageViaHaydi: invalid postType "${target.postType}" — must be page or post.`,
		);
	}
	if (!SLUG_RE.test(target.slug)) {
		throw new Error(
			`readPageViaHaydi: invalid slug "${target.slug}" — must match ${SLUG_RE}.`,
		);
	}
	const code = `
$post = get_page_by_path('${target.slug}', OBJECT, '${target.postType}');
echo json_encode($post
    ? ['found' => true, 'id' => (int) $post->ID, 'content' => $post->post_content]
    : ['found' => false]);
`;
	const result = await runPhp(
		config,
		code,
		`Neptune read ${target.postType}:${target.slug}`,
		signal,
	);
	if (typeof result === 'object' && result !== null) {
		const obj = result as Record<string, unknown>;
		if (obj['found'] === false) return null;
		if (
			obj['found'] === true &&
			typeof obj['id'] === 'number' &&
			typeof obj['content'] === 'string'
		) {
			return {id: obj['id'], content: obj['content']};
		}
	}
	throw new Error(
		`Haydi read ${target.postType}:${target.slug} returned unexpected shape: ${JSON.stringify(result)}`,
	);
}

// Inserts or updates the post_content of a page or post. Mirrors
// Recipe 4 verbatim; no theme term binding (pages aren't theme-scoped).
export async function writePageViaHaydi(
	config: HaydiConfig,
	target: EnsurePageTarget,
	content: string,
	signal?: AbortSignal,
): Promise<{created: boolean; id: number}> {
	if (target.postType !== 'page' && target.postType !== 'post') {
		throw new Error(
			`writePageViaHaydi: invalid postType "${target.postType}" — must be page or post.`,
		);
	}
	if (!SLUG_RE.test(target.slug)) {
		throw new Error(
			`writePageViaHaydi: invalid slug "${target.slug}" — must match ${SLUG_RE}.`,
		);
	}
	const titleB64 = Buffer.from(target.title, 'utf8').toString('base64');
	const contentB64 = Buffer.from(content, 'utf8').toString('base64');
	const code = `
$slug = '${target.slug}';
$postType = '${target.postType}';
$title = base64_decode('${titleB64}');
$content = base64_decode('${contentB64}');
kses_remove_filters();
$existing = get_page_by_path($slug, OBJECT, $postType);
if ($existing) {
    $r = wp_update_post(['ID' => $existing->ID, 'post_content' => $content], true);
    if (is_wp_error($r)) {
        echo json_encode(['error' => $r->get_error_message()]);
        return;
    }
    echo json_encode(['created' => false, 'id' => (int) $existing->ID]);
    return;
}
$id = wp_insert_post([
    'post_type' => $postType,
    'post_status' => 'publish',
    'post_name' => $slug,
    'post_title' => $title,
    'post_content' => $content,
], true);
if (is_wp_error($id)) {
    echo json_encode(['error' => $id->get_error_message()]);
    return;
}
echo json_encode(['created' => true, 'id' => (int) $id]);
`;
	const result = await runPhp(
		config,
		code,
		`Neptune write ${target.postType}:${target.slug} (${content.length} bytes)`,
		signal,
	);
	return parseEnsureResult(result, `${target.postType}:${target.slug}`);
}

// Flushes the WP object cache so the running site picks up theme.json
// / styles/blocks/*.json edits on the next request. Mirrors Recipe 5.
export async function flushThemeJsonCacheViaHaydi(
	config: HaydiConfig,
	signal?: AbortSignal,
): Promise<void> {
	await runPhp(
		config,
		`wp_cache_flush(); echo json_encode(['flushed' => true]);`,
		'Neptune theme.json cache flush',
		signal,
	);
}

function parseEnsureResult(
	result: unknown,
	label: string,
): {created: boolean; id: number} {
	if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
		const obj = result as Record<string, unknown>;
		if (typeof obj['error'] === 'string') {
			throw new Error(`Haydi ensure ${label} failed: ${obj['error']}`);
		}
		if (typeof obj['id'] === 'number' && typeof obj['created'] === 'boolean') {
			return {created: obj['created'], id: obj['id']};
		}
	}
	throw new Error(
		`Haydi ensure ${label} returned unexpected shape: ${JSON.stringify(result)}`,
	);
}
