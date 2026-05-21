import test from 'ava';
import {parseQueryLoopRequirements} from '../../source/lib/wp-query-loop.js';

test('parseQueryLoopRequirements: single post-typed loop with perPage', t => {
	const markup = `<!-- wp:query {"queryId":1,"query":{"perPage":6,"postType":"post","inherit":false}} -->
<div class="wp-block-query">
<!-- wp:post-template -->
<!-- /wp:post-template -->
</div>
<!-- /wp:query -->`;
	t.deepEqual(parseQueryLoopRequirements(markup), [
		{perPage: 6, postType: 'post'},
	]);
});

test('parseQueryLoopRequirements: multiple loops surface independently', t => {
	const markup = `
<!-- wp:query {"queryId":1,"query":{"perPage":3,"postType":"post"}} -->
<!-- /wp:query -->
<!-- wp:query {"queryId":2,"query":{"perPage":8,"postType":"post"}} -->
<!-- /wp:query -->
	`;
	const result = parseQueryLoopRequirements(markup);
	t.is(result.length, 2);
	t.deepEqual(result[0], {perPage: 3, postType: 'post'});
	t.deepEqual(result[1], {perPage: 8, postType: 'post'});
});

test('parseQueryLoopRequirements: postType defaults to post when omitted', t => {
	const markup = `<!-- wp:query {"queryId":1,"query":{"perPage":4}} --><!-- /wp:query -->`;
	t.deepEqual(parseQueryLoopRequirements(markup), [
		{perPage: 4, postType: 'post'},
	]);
});

test('parseQueryLoopRequirements: surfaces CPT loops with their postType', t => {
	const markup = `<!-- wp:query {"queryId":1,"query":{"perPage":5,"postType":"case-study"}} --><!-- /wp:query -->`;
	t.deepEqual(parseQueryLoopRequirements(markup), [
		{perPage: 5, postType: 'case-study'},
	]);
});

test('parseQueryLoopRequirements: skips queries without perPage', t => {
	const markup = `<!-- wp:query {"queryId":1,"query":{"postType":"post","inherit":true}} --><!-- /wp:query -->`;
	t.deepEqual(parseQueryLoopRequirements(markup), []);
});

test('parseQueryLoopRequirements: ignores non-integer or non-positive perPage', t => {
	const markup = `
<!-- wp:query {"query":{"perPage":0}} --><!-- /wp:query -->
<!-- wp:query {"query":{"perPage":-3}} --><!-- /wp:query -->
<!-- wp:query {"query":{"perPage":1.5}} --><!-- /wp:query -->
<!-- wp:query {"query":{"perPage":"6"}} --><!-- /wp:query -->
	`;
	t.deepEqual(parseQueryLoopRequirements(markup), []);
});

test('parseQueryLoopRequirements: tolerates braces inside string values', t => {
	const markup = `<!-- wp:query {"query":{"perPage":6,"label":"a } b"}} --><!-- /wp:query -->`;
	t.deepEqual(parseQueryLoopRequirements(markup), [
		{perPage: 6, postType: 'post'},
	]);
});

test('parseQueryLoopRequirements: tolerates escaped quotes inside string values', t => {
	const markup = `<!-- wp:query {"query":{"perPage":6,"label":"He said \\"hi\\""}} --><!-- /wp:query -->`;
	t.deepEqual(parseQueryLoopRequirements(markup), [
		{perPage: 6, postType: 'post'},
	]);
});

test('parseQueryLoopRequirements: deeply nested objects parse cleanly', t => {
	const markup = `<!-- wp:query {"query":{"perPage":6,"taxQuery":{"category":[1,2,3]}}} --><!-- /wp:query -->`;
	t.deepEqual(parseQueryLoopRequirements(markup), [
		{perPage: 6, postType: 'post'},
	]);
});

test('parseQueryLoopRequirements: malformed JSON is silently skipped', t => {
	const markup = `
<!-- wp:query {"query":{"perPage":6,"postType":"post"}} --><!-- /wp:query -->
<!-- wp:query {not valid json} --><!-- /wp:query -->
	`;
	t.deepEqual(parseQueryLoopRequirements(markup), [
		{perPage: 6, postType: 'post'},
	]);
});

test('parseQueryLoopRequirements: empty markup returns empty array', t => {
	t.deepEqual(parseQueryLoopRequirements(''), []);
});

test('parseQueryLoopRequirements: no wp:query blocks returns empty array', t => {
	t.deepEqual(
		parseQueryLoopRequirements(
			'<!-- wp:paragraph --><p>hi</p><!-- /wp:paragraph -->',
		),
		[],
	);
});

test('parseQueryLoopRequirements: wp:query without attrs is skipped', t => {
	const markup = `<!-- wp:query -->
<div class="wp-block-query"></div>
<!-- /wp:query -->`;
	t.deepEqual(parseQueryLoopRequirements(markup), []);
});
