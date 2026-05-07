import test from 'ava';
import {sortByTemplatePriority} from '../../source/lib/design-walk.js';

test('sortByTemplatePriority: header first, then footer, then the rest', t => {
	const sorted = sortByTemplatePriority([
		{templateFile: 'index.html', slug: 'a'},
		{templateFile: 'footer.html', slug: 'b'},
		{templateFile: 'page.html', slug: 'c'},
		{templateFile: 'header.html', slug: 'd'},
		{templateFile: 'single.html', slug: 'e'},
	]);
	t.deepEqual(
		sorted.map(p => p.slug),
		['d', 'b', 'a', 'c', 'e'],
	);
});

test('sortByTemplatePriority: case-insensitive on header/footer match', t => {
	const sorted = sortByTemplatePriority([
		{templateFile: 'index.html', slug: 'a'},
		{templateFile: 'Footer.HTML', slug: 'b'},
		{templateFile: 'HEADER.html', slug: 'c'},
	]);
	t.deepEqual(
		sorted.map(p => p.slug),
		['c', 'b', 'a'],
	);
});

test('sortByTemplatePriority: no header/footer leaves order untouched', t => {
	const input = [
		{templateFile: 'page.html', slug: 'a'},
		{templateFile: 'index.html', slug: 'b'},
		{templateFile: 'single.html', slug: 'c'},
	];
	t.deepEqual(
		sortByTemplatePriority(input).map(p => p.slug),
		['a', 'b', 'c'],
	);
});

test('sortByTemplatePriority: pulls without templateFile sort to "rest" group, original order', t => {
	const sorted = sortByTemplatePriority([
		{slug: 'a'},
		{templateFile: 'header.html', slug: 'b'},
		{slug: 'c'},
		{templateFile: 'footer.html', slug: 'd'},
	]);
	t.deepEqual(
		sorted.map(p => p.slug),
		['b', 'd', 'a', 'c'],
	);
});

test('sortByTemplatePriority: empty input returns empty array', t => {
	t.deepEqual(sortByTemplatePriority([]), []);
});

test('sortByTemplatePriority: returns a new array (does not mutate input)', t => {
	const input = [
		{templateFile: 'index.html', slug: 'a'},
		{templateFile: 'header.html', slug: 'b'},
	];
	const sorted = sortByTemplatePriority(input);
	t.not(sorted, input);
	t.deepEqual(
		input.map(p => p.slug),
		['a', 'b'],
	);
});
