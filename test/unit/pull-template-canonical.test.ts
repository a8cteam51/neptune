import test from 'ava';
import {canonicalTargetFor} from '../../source/commands/pull-template/canonical-targets.js';

test('canonicalTargetFor: single.html locks to seed post id 1', t => {
	const target = canonicalTargetFor('single.html');
	t.truthy(target);
	t.is(target!.pageSlug, 'hello-world');
	t.is(target!.postType, 'post');
	t.is(target!.previewPath, '/?p=1');
	t.true(target!.forced);
});

test('canonicalTargetFor: page.html offers sample-page as a non-forced default', t => {
	const target = canonicalTargetFor('page.html');
	t.truthy(target);
	t.is(target!.pageSlug, 'sample-page');
	t.is(target!.postType, 'page');
	t.is(target!.previewPath, '/sample-page');
	t.false(target!.forced);
});

test('canonicalTargetFor: case-insensitive on the template filename', t => {
	t.truthy(canonicalTargetFor('Single.HTML'));
	t.truthy(canonicalTargetFor('PAGE.html'));
});

test('canonicalTargetFor: non-canonical templates return null', t => {
	t.is(canonicalTargetFor('index.html'), null);
	t.is(canonicalTargetFor('front-page.html'), null);
	t.is(canonicalTargetFor('header.html'), null);
	t.is(canonicalTargetFor('archive.html'), null);
});
