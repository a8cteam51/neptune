import test from 'ava';
import {
	templateRole,
	templateSubdir,
} from '../../source/lib/template-scaffold.js';

test('templateRole: header.html / footer.html / page', t => {
	t.is(templateRole('header.html'), 'header');
	t.is(templateRole('footer.html'), 'footer');
	t.is(templateRole('index.html'), 'page');
	t.is(templateRole('front-page.html'), 'page');
	t.is(templateRole('404.html'), 'page');
});

test('templateRole: case-insensitive match', t => {
	t.is(templateRole('Header.HTML'), 'header');
	t.is(templateRole('FOOTER.html'), 'footer');
});

test('templateSubdir: header/footer go to parts; everything else templates', t => {
	t.is(templateSubdir('header.html'), 'parts');
	t.is(templateSubdir('footer.html'), 'parts');
	t.is(templateSubdir('index.html'), 'templates');
	t.is(templateSubdir('single-product.html'), 'templates');
});
