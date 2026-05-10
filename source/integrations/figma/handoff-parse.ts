// Pure XML parsers for the artifacts pullFromFigma writes. All regex-
// based; no XML parser dep. Limits documented per-function.
import type {TitleCardRef} from '../../lib/types.js';

// Lazy-match between <frame name="Title Card"> and the next </frame>.
// Assumes Title Card frames don't contain nested <frame> children — true
// for current Figma metadata.xml output. If that ever changes, the inner
// text capture will close at the wrong tag and miss the title text.
export function parseTitleCards(xml: string): TitleCardRef[] {
	const cards: TitleCardRef[] = [];
	const re = /<frame\b[^>]*\bname="Title Card"[^>]*>([\s\S]*?)<\/frame>/g;
	for (const match of xml.matchAll(re)) {
		const openEnd = match[0].indexOf('>');
		const openTag = match[0].slice(0, openEnd + 1);
		const id = /\bid="([^"]*)"/.exec(openTag)?.[1];
		const inner = match[1] ?? '';
		const textMatch = /<text\b[^>]*\bname="([^"]*)"[^>]*\/?>/.exec(inner);
		const name = textMatch?.[1];
		if (id && name) cards.push({id, name});
	}
	return cards;
}

// Reads width/height from the first element in metadata.xml. The
// element is whatever the user selected in Figma — currently either
// <instance> (component instance) or <frame> (raw frame). XML prolog
// (<?xml … ?>), DOCTYPE, and comments are skipped because the leading
// `<?` / `<!` are excluded by the [a-zA-Z] anchor on the tag name.
export function parseRootElementSize(
	xml: string,
): {width: number; height: number} | null {
	const m = /<([a-zA-Z][\w-]*)\b[^>]*>/.exec(xml);
	if (!m) return null;
	const tag = m[0];
	const w = /\bwidth="([0-9.]+)"/.exec(tag)?.[1];
	const h = /\bheight="([0-9.]+)"/.exec(tag)?.[1];
	if (w === undefined || h === undefined) return null;
	const width = Number(w);
	const height = Number(h);
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	return {width, height};
}
