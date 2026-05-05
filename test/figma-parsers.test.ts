import test from 'ava';
import {extractAssetUrls} from '../source/integrations/figma/assets-fetch.js';
import {
	extractJsxText,
	parseDevNoteIds,
	parseTitleCards,
} from '../source/integrations/figma/handoff-parse.js';
import {stripLlmInstructions} from '../source/integrations/figma/mcp.js';
import {slugify} from '../source/commands/pull-template/special-meta.js';

test('extractAssetUrls dedupes by URL', t => {
	const code = `
const imgA = "http://localhost:3845/assets/aaa.png";
const imgB = "http://localhost:3845/assets/bbb.svg";
const imgA2 = "http://localhost:3845/assets/aaa.png";
const imgC = "http://localhost:3845/assets/ccc.svg";
`;
	t.deepEqual(extractAssetUrls(code), [
		'http://localhost:3845/assets/aaa.png',
		'http://localhost:3845/assets/bbb.svg',
		'http://localhost:3845/assets/ccc.svg',
	]);
});

test('extractAssetUrls ignores non-localhost URLs', t => {
	const code = `
const imgRemote = "https://example.com/assets/aaa.png";
const imgLocal = "http://localhost:3845/assets/bbb.svg";
`;
	t.deepEqual(extractAssetUrls(code), [
		'http://localhost:3845/assets/bbb.svg',
	]);
});

test('parseDevNoteIds matches loosely on name', t => {
	const xml = `
<frame>
  <instance id="1:1" name="Dev Note" />
  <instance id="1:2" name="💬 Dev Note" />
  <instance id="1:3" name="dev note - hero" />
  <instance id="1:4" name="DevNote" />
  <instance id="1:5" name="Other" />
</frame>
`;
	t.deepEqual(parseDevNoteIds(xml), ['1:1', '1:2', '1:3']);
});

test('parseTitleCards extracts inner text element name', t => {
	const xml = `
<frame>
  <frame id="2:1" name="Title Card">
    <text id="2:2" name="Menu" />
  </frame>
  <frame id="2:3" name="Title Card">
    <text id="2:4" name="Hero" />
  </frame>
</frame>
`;
	t.deepEqual(parseTitleCards(xml), [
		{id: '2:1', name: 'Menu'},
		{id: '2:3', name: 'Hero'},
	]);
});

test('extractJsxText collapses whitespace and skips JSX expressions', t => {
	const code = `
function X() {
  return (
    <div>
      <p>Hello   world</p>
      <span>{count}</span>
      <p>Another   line</p>
    </div>
  );
}
`;
	t.is(extractJsxText(code), 'Hello world Another line');
});

test('stripLlmInstructions cuts code.tsx LLM tail at SUPER CRITICAL', t => {
	const tsx =
		'function Foo() { return <div />; }\nSUPER CRITICAL: The generated React+Tailwind code MUST be converted...';
	t.is(
		stripLlmInstructions('code.tsx', tsx),
		'function Foo() { return <div />; }\n',
	);
});

test('stripLlmInstructions cuts metadata.xml at IMPORTANT', t => {
	const xml =
		'<instance id="1:1" />\nIMPORTANT: After you call this tool, you MUST...';
	t.is(stripLlmInstructions('metadata.xml', xml), '<instance id="1:1" />\n');
});

test('stripLlmInstructions passes through unknown filenames', t => {
	const text = 'no markers here';
	t.is(stripLlmInstructions('variables.json', text), 'no markers here');
});

test('slugify handles emojis, diacritics, and spaces', t => {
	t.is(slugify('Menu'), 'menu');
	t.is(slugify('Hero Section'), 'hero-section');
	t.is(slugify('Footer / Light'), 'footer-light');
	t.is(slugify('💬 Notes'), 'notes');
	t.is(slugify('Café Olé'), 'cafe-ole');
	t.is(slugify('   '), '');
});
