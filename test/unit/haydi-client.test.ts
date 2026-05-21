import test from 'ava';
import type {ExecutionContext} from 'ava';
import {
	ensurePageViaHaydi,
	ensureTemplateViaHaydi,
	flushThemeJsonCacheViaHaydi,
	preflight,
	readPageViaHaydi,
	readTemplateViaHaydi,
	runPhp,
	writePageViaHaydi,
	writeTemplateViaHaydi,
} from '../../source/integrations/haydi/client.js';

type FetchCall = {url: string; init: RequestInit | undefined};
type FetchHandler = (
	call: FetchCall,
	index: number,
) => Response | Promise<Response>;

// Replaces globalThis.fetch with a recording stub for the duration of one
// test. `t.teardown` restores the real fetch, so every test starts with
// a clean slate even though ava runs file-level tests in parallel by
// default.
function stubFetch(
	t: ExecutionContext,
	handler: FetchHandler,
): {calls: FetchCall[]} {
	const calls: FetchCall[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const call: FetchCall = {url, init};
		const index = calls.length;
		calls.push(call);
		return handler(call, index);
	}) as typeof fetch;
	t.teardown(() => {
		globalThis.fetch = original;
	});
	return {calls};
}

function jsonRpcText(text: string): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			result: {content: [{type: 'text', text}]},
		}),
		{status: 200, headers: {'Content-Type': 'application/json'}},
	);
}

function jsonRpcError(message: string): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			error: {code: -32000, message},
		}),
		{status: 200, headers: {'Content-Type': 'application/json'}},
	);
}

const cfg = {url: 'http://localhost:8893', token: 'tok'} as const;

// ---------------------------------------------------------------------------
// preflight
// ---------------------------------------------------------------------------

test.serial('preflight: throws when token is missing', async t => {
	stubFetch(t, () => new Response('', {status: 200}));
	await t.throwsAsync(
		preflight({url: 'http://localhost:8893', token: ''}),
		{message: /Haydi token is missing/},
	);
});

test.serial('preflight: throws an auth-specific message on 401', async t => {
	stubFetch(t, () => new Response('', {status: 401, statusText: 'Unauthorized'}));
	await t.throwsAsync(preflight(cfg), {
		message: /Haydi auth failed.*HTTP 401.*Bearer token/,
	});
});

test.serial('preflight: throws an auth-specific message on 403', async t => {
	stubFetch(t, () => new Response('', {status: 403, statusText: 'Forbidden'}));
	await t.throwsAsync(preflight(cfg), {
		message: /Haydi auth failed.*HTTP 403.*Bearer token/,
	});
});

test.serial('preflight: throws on non-2xx status that is not 401/403', async t => {
	stubFetch(
		t,
		() => new Response('', {status: 500, statusText: 'Server Error'}),
	);
	await t.throwsAsync(preflight(cfg), {
		message: /Haydi status check failed.*HTTP 500/,
	});
});

test.serial('preflight: throws when required tools are missing from tools/list', async t => {
	stubFetch(t, (_, i) => {
		if (i === 0) return new Response('', {status: 200});
		return new Response(
			JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				result: {tools: [{name: 'haydi_run_php'}]},
			}),
			{status: 200},
		);
	});
	await t.throwsAsync(preflight(cfg), {
		message: /missing required tools: haydi_run_query/,
	});
});

test.serial('preflight: throws when tools/list returns a JSON-RPC error', async t => {
	stubFetch(t, (_, i) => {
		if (i === 0) return new Response('', {status: 200});
		return jsonRpcError('listing disabled');
	});
	await t.throwsAsync(preflight(cfg), {
		message: /tools\/list error: listing disabled/,
	});
});

test.serial('preflight: succeeds when status is OK and both required tools are present', async t => {
	const {calls} = stubFetch(t, (_, i) => {
		if (i === 0) return new Response('', {status: 200});
		return new Response(
			JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				result: {
					tools: [
						{name: 'haydi_run_php'},
						{name: 'haydi_run_query'},
						{name: 'haydi_extra'},
					],
				},
			}),
			{status: 200},
		);
	});
	await t.notThrowsAsync(preflight(cfg));
	t.is(calls.length, 2);
	t.is(calls[0]!.url, 'http://localhost:8893/wp-json/haydi/v1/status');
	t.is(calls[1]!.url, 'http://localhost:8893/wp-json/haydi/v1/mcp');
});

test.serial('preflight: sends Bearer header on the status probe', async t => {
	const {calls} = stubFetch(t, (_, i) => {
		if (i === 0) return new Response('', {status: 200});
		return new Response(
			JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				result: {tools: [{name: 'haydi_run_php'}, {name: 'haydi_run_query'}]},
			}),
			{status: 200},
		);
	});
	await preflight(cfg);
	const headers = new Headers(calls[0]!.init?.headers);
	t.is(headers.get('authorization'), 'Bearer tok');
});

// ---------------------------------------------------------------------------
// runPhp
// ---------------------------------------------------------------------------

test.serial('runPhp: throws when token is missing', async t => {
	stubFetch(t, () => jsonRpcText('{}'));
	await t.throwsAsync(
		runPhp({url: 'http://localhost:8893', token: ''}, 'echo 1;', 'why'),
		{message: /Haydi token is missing/},
	);
});

test.serial('runPhp: returns null for the "(no output)" sentinel', async t => {
	stubFetch(t, () => jsonRpcText('(no output)'));
	t.is(await runPhp(cfg, 'echo "";', 'why'), null);
});

test.serial('runPhp: parses JSON output when the snippet echoes JSON', async t => {
	stubFetch(t, () => jsonRpcText('{"created":true,"id":42}'));
	t.deepEqual(await runPhp(cfg, 'echo json_encode([...]);', 'why'), {
		created: true,
		id: 42,
	});
});

test.serial('runPhp: returns the raw text when the echoed payload is not JSON', async t => {
	stubFetch(t, () => jsonRpcText('hello world'));
	t.is(await runPhp(cfg, 'echo "hello world";', 'why'), 'hello world');
});

test.serial('runPhp: throws on a non-2xx HTTP response', async t => {
	stubFetch(
		t,
		() => new Response('boom', {status: 502, statusText: 'Bad Gateway'}),
	);
	await t.throwsAsync(runPhp(cfg, 'echo 1;', 'why'), {
		message: /tools\/call → HTTP 502 Bad Gateway/,
	});
});

test.serial('runPhp: throws when the JSON-RPC envelope carries an error', async t => {
	stubFetch(t, () => jsonRpcError('php parse error'));
	await t.throwsAsync(runPhp(cfg, 'echo;', 'why'), {
		message: /haydi_run_php error: php parse error/,
	});
});

test.serial('runPhp: throws when content blocks are missing', async t => {
	stubFetch(t, () =>
		new Response(
			JSON.stringify({jsonrpc: '2.0', id: 1, result: {content: []}}),
			{status: 200},
		),
	);
	await t.throwsAsync(runPhp(cfg, 'echo 1;', 'why'), {
		message: /returned no content blocks/,
	});
});

test.serial('runPhp: throws when the first content block is not type=text', async t => {
	stubFetch(t, () =>
		new Response(
			JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				result: {content: [{type: 'image', text: 'irrelevant'}]},
			}),
			{status: 200},
		),
	);
	await t.throwsAsync(runPhp(cfg, 'echo 1;', 'why'), {
		message: /returned non-text content block/,
	});
});

test.serial('runPhp: posts to /wp-json/haydi/v1/mcp with Bearer auth and JSON-RPC body', async t => {
	const {calls} = stubFetch(t, () => jsonRpcText('null'));
	await runPhp(cfg, 'echo 1;', 'unit-test reason');
	t.is(calls.length, 1);
	t.is(calls[0]!.url, 'http://localhost:8893/wp-json/haydi/v1/mcp');
	const init = calls[0]!.init!;
	t.is(init.method, 'POST');
	const headers = new Headers(init.headers);
	t.is(headers.get('content-type'), 'application/json');
	t.is(headers.get('authorization'), 'Bearer tok');
	const body = JSON.parse(init.body as string) as {
		method: string;
		params: {name: string; arguments: {code: string; reason: string}};
	};
	t.is(body.method, 'tools/call');
	t.is(body.params.name, 'haydi_run_php');
	t.is(body.params.arguments.code, 'echo 1;');
	t.is(body.params.arguments.reason, 'unit-test reason');
});

// ---------------------------------------------------------------------------
// ensureTemplateViaHaydi
// ---------------------------------------------------------------------------

test.serial('ensureTemplateViaHaydi: rejects an unknown post type before calling fetch', async t => {
	const {calls} = stubFetch(t, () => jsonRpcText('{}'));
	await t.throwsAsync(
		ensureTemplateViaHaydi(cfg, {
			type: 'page' as unknown as 'wp_template',
			slug: 'home',
			title: 'Home',
		}),
		{message: /invalid type "page"/},
	);
	t.is(calls.length, 0);
});

test.serial('ensureTemplateViaHaydi: rejects a slug with invalid characters before calling fetch', async t => {
	const {calls} = stubFetch(t, () => jsonRpcText('{}'));
	await t.throwsAsync(
		ensureTemplateViaHaydi(cfg, {
			type: 'wp_template',
			slug: 'BAD slug',
			title: 'X',
		}),
		{message: /invalid slug "BAD slug"/},
	);
	t.is(calls.length, 0);
});

test.serial('ensureTemplateViaHaydi: rejects empty slug', async t => {
	stubFetch(t, () => jsonRpcText('{}'));
	await t.throwsAsync(
		ensureTemplateViaHaydi(cfg, {
			type: 'wp_template',
			slug: '',
			title: 'X',
		}),
		{message: /invalid slug ""/},
	);
});

test.serial('ensureTemplateViaHaydi: allows numeric leading slugs like "404"', async t => {
	stubFetch(t, () => jsonRpcText('{"created":true,"id":7}'));
	const r = await ensureTemplateViaHaydi(cfg, {
		type: 'wp_template',
		slug: '404',
		title: 'Not Found',
	});
	t.deepEqual(r, {created: true, id: 7});
});

test.serial('ensureTemplateViaHaydi: base64-encodes the title in the PHP payload', async t => {
	const {calls} = stubFetch(t, () => jsonRpcText('{"created":true,"id":1}'));
	await ensureTemplateViaHaydi(cfg, {
		type: 'wp_template',
		slug: 'home',
		title: "O'Reilly & Friends",
	});
	const body = JSON.parse(calls[0]!.init!.body as string) as {
		params: {arguments: {code: string}};
	};
	const code = body.params.arguments.code;
	const expected = Buffer.from("O'Reilly & Friends", 'utf8').toString('base64');
	t.true(
		code.includes(`base64_decode('${expected}')`),
		`expected code to embed base64 title, got: ${code}`,
	);
	// And critically: never the raw title (would be a PHP-injection vector).
	t.false(code.includes("O'Reilly"));
});

test.serial('ensureTemplateViaHaydi: returns the parsed {created,id} when the PHP echoes a success envelope', async t => {
	stubFetch(t, () => jsonRpcText('{"created":false,"id":42}'));
	t.deepEqual(
		await ensureTemplateViaHaydi(cfg, {
			type: 'wp_template',
			slug: 'home',
			title: 'Home',
		}),
		{created: false, id: 42},
	);
});

test.serial('ensureTemplateViaHaydi: surfaces the PHP error message when the envelope carries one', async t => {
	stubFetch(t, () => jsonRpcText('{"error":"insert failed: capability"}'));
	await t.throwsAsync(
		ensureTemplateViaHaydi(cfg, {
			type: 'wp_template',
			slug: 'home',
			title: 'Home',
		}),
		{message: /ensure wp_template:home failed: insert failed: capability/},
	);
});

test.serial('ensureTemplateViaHaydi: throws on an unexpected envelope shape', async t => {
	stubFetch(t, () => jsonRpcText('{"created":"yes","id":"forty"}'));
	await t.throwsAsync(
		ensureTemplateViaHaydi(cfg, {
			type: 'wp_template',
			slug: 'home',
			title: 'Home',
		}),
		{message: /returned unexpected shape/},
	);
});

// ---------------------------------------------------------------------------
// ensurePageViaHaydi
// ---------------------------------------------------------------------------

test.serial('ensurePageViaHaydi: rejects an unknown postType before calling fetch', async t => {
	const {calls} = stubFetch(t, () => jsonRpcText('{}'));
	await t.throwsAsync(
		ensurePageViaHaydi(cfg, {
			postType: 'wp_template' as unknown as 'page',
			slug: 'about',
			title: 'About',
		}),
		{message: /invalid postType "wp_template"/},
	);
	t.is(calls.length, 0);
});

test.serial('ensurePageViaHaydi: rejects an invalid slug before calling fetch', async t => {
	const {calls} = stubFetch(t, () => jsonRpcText('{}'));
	await t.throwsAsync(
		ensurePageViaHaydi(cfg, {
			postType: 'page',
			slug: 'has spaces',
			title: 'X',
		}),
		{message: /invalid slug "has spaces"/},
	);
	t.is(calls.length, 0);
});

test.serial('ensurePageViaHaydi: returns parsed envelope on success', async t => {
	stubFetch(t, () => jsonRpcText('{"created":true,"id":99}'));
	t.deepEqual(
		await ensurePageViaHaydi(cfg, {
			postType: 'post',
			slug: 'hello-world',
			title: 'Hello',
		}),
		{created: true, id: 99},
	);
});

// ---------------------------------------------------------------------------
// readTemplateViaHaydi
// ---------------------------------------------------------------------------

test.serial('readTemplateViaHaydi: returns null when the row is not found', async t => {
	stubFetch(t, () => jsonRpcText('{"found":false}'));
	t.is(
		await readTemplateViaHaydi(cfg, {type: 'wp_template', slug: 'home'}),
		null,
	);
});

test.serial('readTemplateViaHaydi: returns the content string when the row exists', async t => {
	stubFetch(t, () =>
		jsonRpcText('{"found":true,"content":"<!-- wp:paragraph -->hi"}'),
	);
	t.is(
		await readTemplateViaHaydi(cfg, {type: 'wp_template', slug: 'home'}),
		'<!-- wp:paragraph -->hi',
	);
});

test.serial('readTemplateViaHaydi: throws on an unexpected envelope shape', async t => {
	stubFetch(t, () => jsonRpcText('{"found":true}'));
	await t.throwsAsync(
		readTemplateViaHaydi(cfg, {type: 'wp_template', slug: 'home'}),
		{message: /returned unexpected shape/},
	);
});

test.serial('readTemplateViaHaydi: rejects an invalid template type without a fetch', async t => {
	const {calls} = stubFetch(t, () => jsonRpcText('{}'));
	await t.throwsAsync(
		readTemplateViaHaydi(cfg, {
			type: 'wp_block' as unknown as 'wp_template',
			slug: 'home',
		}),
		{message: /invalid type "wp_block"/},
	);
	t.is(calls.length, 0);
});

// ---------------------------------------------------------------------------
// writeTemplateViaHaydi
// ---------------------------------------------------------------------------

test.serial('writeTemplateViaHaydi: base64-encodes the content payload', async t => {
	const content = '<!-- wp:paragraph --><p>"x"</p><!-- /wp:paragraph -->';
	const {calls} = stubFetch(t, () => jsonRpcText('{"created":false,"id":7}'));
	const r = await writeTemplateViaHaydi(
		cfg,
		{type: 'wp_template', slug: 'home', title: 'Home'},
		content,
	);
	t.deepEqual(r, {created: false, id: 7});
	const body = JSON.parse(calls[0]!.init!.body as string) as {
		params: {arguments: {code: string; reason: string}};
	};
	const expectedContentB64 = Buffer.from(content, 'utf8').toString('base64');
	t.true(body.params.arguments.code.includes(expectedContentB64));
	// Reason field surfaces byte-count for telemetry; verify it's wired.
	t.regex(body.params.arguments.reason, /\(\d+ bytes\)/);
});

test.serial('writeTemplateViaHaydi: rejects a slug that looks like a path traversal', async t => {
	stubFetch(t, () => jsonRpcText('{}'));
	await t.throwsAsync(
		writeTemplateViaHaydi(
			cfg,
			{type: 'wp_template', slug: '../etc', title: 'X'},
			'',
		),
		{message: /invalid slug/},
	);
});

// ---------------------------------------------------------------------------
// readPageViaHaydi
// ---------------------------------------------------------------------------

test.serial('readPageViaHaydi: returns null when the page is not found', async t => {
	stubFetch(t, () => jsonRpcText('{"found":false}'));
	t.is(await readPageViaHaydi(cfg, {postType: 'page', slug: 'about'}), null);
});

test.serial('readPageViaHaydi: returns {id,content} on success', async t => {
	stubFetch(t, () =>
		jsonRpcText('{"found":true,"id":12,"content":"<!-- wp:paragraph -->"}'),
	);
	t.deepEqual(
		await readPageViaHaydi(cfg, {postType: 'page', slug: 'about'}),
		{id: 12, content: '<!-- wp:paragraph -->'},
	);
});

test.serial('readPageViaHaydi: throws when id is not a number', async t => {
	stubFetch(t, () => jsonRpcText('{"found":true,"id":"12","content":""}'));
	await t.throwsAsync(
		readPageViaHaydi(cfg, {postType: 'page', slug: 'about'}),
		{message: /returned unexpected shape/},
	);
});

// ---------------------------------------------------------------------------
// writePageViaHaydi
// ---------------------------------------------------------------------------

test.serial('writePageViaHaydi: base64-encodes content + title and posts to /mcp', async t => {
	const {calls} = stubFetch(t, () => jsonRpcText('{"created":true,"id":33}'));
	const r = await writePageViaHaydi(
		cfg,
		{postType: 'page', slug: 'about', title: 'About'},
		'<p>hi</p>',
	);
	t.deepEqual(r, {created: true, id: 33});
	const code = (JSON.parse(calls[0]!.init!.body as string) as {
		params: {arguments: {code: string}};
	}).params.arguments.code;
	t.true(code.includes(Buffer.from('<p>hi</p>', 'utf8').toString('base64')));
	t.true(code.includes(Buffer.from('About', 'utf8').toString('base64')));
});

// ---------------------------------------------------------------------------
// flushThemeJsonCacheViaHaydi
// ---------------------------------------------------------------------------

test.serial('flushThemeJsonCacheViaHaydi: runs wp_cache_flush() via runPhp', async t => {
	const {calls} = stubFetch(t, () => jsonRpcText('{"flushed":true}'));
	await flushThemeJsonCacheViaHaydi(cfg);
	const body = JSON.parse(calls[0]!.init!.body as string) as {
		params: {name: string; arguments: {code: string; reason: string}};
	};
	t.is(body.params.name, 'haydi_run_php');
	t.true(body.params.arguments.code.includes('wp_cache_flush()'));
});
