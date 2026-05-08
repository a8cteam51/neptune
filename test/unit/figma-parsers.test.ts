import test from 'ava';
import {
	extractAssetRefs,
	extractAssetUrls,
} from '../../source/integrations/figma/assets-fetch.js';
import {parseTitleCards} from '../../source/integrations/figma/handoff-parse.js';
import {stripLlmInstructions} from '../../source/integrations/figma/mcp.js';
import {slugify} from '../../source/commands/pull-template/special-meta.js';

test('extractAssetUrls keeps PNG/JPG, drops SVG and other formats', t => {
	const code = `
const imgA = "http://localhost:3845/assets/aaa.png";
const imgB = "http://localhost:3845/assets/bbb.svg";
const imgA2 = "http://localhost:3845/assets/aaa.png";
const imgC = "http://localhost:3845/assets/ccc.jpg";
const imgD = "http://localhost:3845/assets/ddd.jpeg";
const imgE = "http://localhost:3845/assets/eee.webp";
const imgF = "http://localhost:3845/assets/fff.PNG";
`;
	t.deepEqual(extractAssetUrls(code), [
		'http://localhost:3845/assets/aaa.png',
		'http://localhost:3845/assets/ccc.jpg',
		'http://localhost:3845/assets/ddd.jpeg',
		'http://localhost:3845/assets/fff.PNG',
	]);
});

test('extractAssetUrls ignores non-localhost URLs', t => {
	const code = `
const imgRemote = "https://example.com/assets/aaa.png";
const imgLocal = "http://localhost:3845/assets/bbb.png";
`;
	t.deepEqual(extractAssetUrls(code), ['http://localhost:3845/assets/bbb.png']);
});

test('extractAssetUrls ignores let/var/inline URLs (anchored to const at line start)', t => {
	const code = `
let imgA = "http://localhost:3845/assets/aaa.png";
var imgB = "http://localhost:3845/assets/bbb.png";
const imgC = "http://localhost:3845/assets/ccc.png";
const inJsx = <img src="http://localhost:3845/assets/ddd.png" />;
`;
	t.deepEqual(extractAssetUrls(code), ['http://localhost:3845/assets/ccc.png']);
});

test('extractAssetRefs returns const name + filename per ref', t => {
	const code = `
const imgHero = "http://localhost:3845/assets/aaa1234.png";
const imgIcon = "http://localhost:3845/assets/bbb5678.svg";
const imgFoot = "http://localhost:3845/assets/ccc9999.jpg";
`;
	t.deepEqual(extractAssetRefs(code), [
		{
			constName: 'imgHero',
			url: 'http://localhost:3845/assets/aaa1234.png',
			filename: 'aaa1234.png',
		},
		{
			constName: 'imgFoot',
			url: 'http://localhost:3845/assets/ccc9999.jpg',
			filename: 'ccc9999.jpg',
		},
	]);
});

test('extractAssetRefs dedupes by URL, first const wins', t => {
	const code = `
const imgA = "http://localhost:3845/assets/aaa.png";
const imgAlias = "http://localhost:3845/assets/aaa.png";
`;
	const refs = extractAssetRefs(code);
	t.is(refs.length, 1);
	t.is(refs[0]!.constName, 'imgA');
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
