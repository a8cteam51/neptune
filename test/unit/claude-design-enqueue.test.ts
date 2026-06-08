import test from 'ava';
import {extractHeadBits} from '../../source/integrations/claude-design/enqueue.js';

test('extractHeadBits: decodes HTML entities in the fonts href', t => {
	const html = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&amp;family=IBM+Plex+Mono&amp;display=swap" rel="stylesheet" />
</head><body></body></html>`;
	const bits = extractHeadBits(html);
	// The raw HTML carries &amp;; the enqueued URL must use real &.
	t.is(
		bits.fontsHref,
		'https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=IBM+Plex+Mono&display=swap',
	);
	t.false(bits.fontsHref!.includes('&amp;'));
});

test('extractHeadBits: captures the no-flash theme script body', t => {
	const html = `<head><script>(function(){try{if(localStorage.getItem('tr-theme')==='ink')document.documentElement.setAttribute('data-theme','ink');}catch(e){}})();</script></head>`;
	const bits = extractHeadBits(html);
	t.truthy(bits.noFlashScript);
	t.true(bits.noFlashScript!.includes('localStorage'));
	t.false(bits.noFlashScript!.includes('<script'));
});

test('extractHeadBits: returns nulls when nothing relevant is present', t => {
	const bits = extractHeadBits('<head><title>x</title></head>');
	t.is(bits.fontsHref, null);
	t.is(bits.noFlashScript, null);
});
