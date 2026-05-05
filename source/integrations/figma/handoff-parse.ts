// Pure XML/JSX parsers for the artifacts pullFromFigma writes. All regex-
// based; no XML parser dep. Limits documented per-function.
import type {TitleCardRef} from '../../lib/types.js';

// Loose substring match: any <instance> whose name contains "dev note"
// (case-insensitive) counts. Catches "Dev Note", "💬 Dev Note",
// "dev note - hero". Excludes "DevNote" — must be the words separated.
export function parseDevNoteIds(xml: string): string[] {
	const ids: string[] = [];
	const re = /<instance\b[^>]*\/>/g;
	for (const match of xml.matchAll(re)) {
		const name = /\bname="([^"]*)"/.exec(match[0])?.[1];
		if (name === undefined) continue;
		if (!/dev note/i.test(name)) continue;
		const id = /\bid="([^"]*)"/.exec(match[0])?.[1];
		if (id) ids.push(id);
	}
	return ids;
}

// Lazy-match between <frame name="Title Card"> and the next </frame>.
// Assumes Title Card frames don't contain nested <frame> children — true
// for current Figma metadata.xml output. If that ever changes, the inner
// text capture will close at the wrong tag and miss the title text.
export function parseTitleCards(xml: string): TitleCardRef[] {
	const cards: TitleCardRef[] = [];
	const re =
		/<frame\b[^>]*\bname="Title Card"[^>]*>([\s\S]*?)<\/frame>/g;
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

// Tag-strip heuristic. Matches plain text between `>` and `<` that
// contains no JSX expression braces. Loses content inside {expressions}
// and concatenates sibling text with single spaces — fine for short
// dev-note copy, lossy for anything structural.
export function extractJsxText(jsx: string): string {
	const parts: string[] = [];
	const re = />([^<{}]+)</g;
	for (const match of jsx.matchAll(re)) {
		const t = (match[1] ?? '')
			.replace(/&apos;/g, "'")
			.replace(/&quot;/g, '"')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/\s+/g, ' ')
			.trim();
		if (t !== '') parts.push(t);
	}
	return parts.join(' ');
}
