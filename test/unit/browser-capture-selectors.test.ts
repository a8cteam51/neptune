import test from 'ava';
import {selectorForRole} from '../../source/lib/browser-capture.js';

test('selectorForRole: header → [data-template-part="header"]', t => {
	t.is(selectorForRole('header'), '[data-template-part="header"]');
});

test('selectorForRole: footer → [data-template-part="footer"]', t => {
	t.is(selectorForRole('footer'), '[data-template-part="footer"]');
});

test('selectorForRole: page role yields no selector (full viewport capture)', t => {
	t.is(selectorForRole('page'), undefined);
});
