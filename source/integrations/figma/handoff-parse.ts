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
