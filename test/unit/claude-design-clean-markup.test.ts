import test from 'ava';
import {stripNonBlockComments} from '../../source/integrations/claude-design/clean-markup.js';

test('removes annotation comments but keeps block delimiters', t => {
	const input = [
		'<!-- wp:group -->',
		'<div class="wp-block-group">',
		'\t<!-- THE LOOP -->',
		'\t<!-- wp:paragraph -->',
		'\t<p>hi</p>',
		'\t<!-- /wp:paragraph -->',
		'</div>',
		'<!-- /wp:group -->',
	].join('\n');
	const out = stripNonBlockComments(input);
	t.false(out.includes('THE LOOP'));
	t.true(out.includes('<!-- wp:group -->'));
	t.true(out.includes('<!-- /wp:group -->'));
	t.true(out.includes('<!-- wp:paragraph -->'));
	t.true(out.includes('<!-- /wp:paragraph -->'));
	t.true(out.includes('<p>hi</p>'));
});

test('preserves self-closing and closing delimiters', t => {
	const input =
		'<!-- wp:post-title {"isLink":true} /-->\n<!-- decorative -->\n<!-- /wp:query -->';
	const out = stripNonBlockComments(input);
	t.true(out.includes('<!-- wp:post-title {"isLink":true} /-->'));
	t.true(out.includes('<!-- /wp:query -->'));
	t.false(out.includes('decorative'));
});

test('keeps wp:html delimiters while dropping a neighboring annotation', t => {
	const input =
		'<!-- THEME SWITCH -->\n<!-- wp:html --><button>x</button><!-- /wp:html -->';
	const out = stripNonBlockComments(input);
	t.false(out.includes('THEME SWITCH'));
	t.true(out.includes('<!-- wp:html --><button>x</button><!-- /wp:html -->'));
});

test('collapses blank lines left behind, preserves real indentation', t => {
	const input = 'A\n\t<!-- note -->\n\n\nB';
	const out = stripNonBlockComments(input);
	// The comment line becomes blank; runs of blank lines collapse to one.
	t.is(out, 'A\n\nB');
});

test('no-op when there are no non-block comments', t => {
	const input = '<!-- wp:spacer /-->\n<div></div>';
	t.is(stripNonBlockComments(input), input);
});
