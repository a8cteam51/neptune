// Manages a section-marked region of WordPress's "Additional CSS"
// (Customizer custom_css). Each block-style variation gets its own
// section bounded by Neptune marker comments:
//
//   /* @neptune-start core/button is-style-fill-small */
//   .wp-block-button.is-style-fill-small { ... }
//   /* @neptune-end core/button is-style-fill-small */
//
// Anything outside any marker pair is preserved as user-authored CSS.
// A future npm command can extract these sections into per-block
// stylesheet files; until then they live in the Customizer where the
// site renders them automatically.
import {b64Arg, runNeptuneCli} from './neptune-cli.js';
import {dBoolean, dObject, dString} from './decode.js';
import type {StudioSession} from '../integrations/studio/mcp.js';

export type SectionKey = {
	block: string; // e.g. core/button
	style: string; // e.g. fill-small
};

export type Section = SectionKey & {
	css: string;
};

const KEY_RE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const STYLE_RE = /^[a-z][a-z0-9-]*$/;

const MARKER_RE =
	/\/\* @neptune-(start|end) ([^\s*]+) ([^\s*]+) \*\/[ \t]*\n?/g;

export type Parsed = {
	sections: Map<string, Section>; // key = `${block}::${style}`
	preface: string; // content before first marker (or whole input if none)
	suffix: string; // content after the last @neptune-end marker
};

export function parseCustomCss(input: string): Parsed {
	const sections = new Map<string, Section>();
	let preface = input;
	let suffix = '';

	const hits: Array<{
		kind: 'start' | 'end';
		key: string;
		afterIdx: number;
		startIdx: number;
	}> = [];

	MARKER_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = MARKER_RE.exec(input)) !== null) {
		hits.push({
			kind: match[1] as 'start' | 'end',
			key: `${match[2]}::${match[3]}`,
			startIdx: match.index,
			afterIdx: match.index + match[0].length,
		});
	}

	if (hits.length === 0) {
		return {sections, preface, suffix: ''};
	}

	preface = input.slice(0, hits[0]!.startIdx);

	for (let i = 0; i < hits.length; i++) {
		const start = hits[i]!;
		if (start.kind !== 'start') continue;
		const matchingEnd = hits.find(
			(h, j) => j > i && h.kind === 'end' && h.key === start.key,
		);
		if (!matchingEnd) continue;
		const cssBody = input.slice(start.afterIdx, matchingEnd.startIdx);
		const [block, style] = start.key.split('::') as [string, string];
		sections.set(start.key, {block, style, css: stripBoundaryNewlines(cssBody)});
	}

	const lastEnd = [...hits].reverse().find(h => h.kind === 'end');
	if (lastEnd) {
		suffix = input.slice(lastEnd.afterIdx);
	}

	return {sections, preface, suffix};
}

export function serializeCustomCss(parsed: Parsed): string {
	const parts: string[] = [];
	const preface = parsed.preface.replace(/\s+$/u, '');
	if (preface !== '') {
		parts.push(preface, '');
	}
	for (const section of parsed.sections.values()) {
		parts.push(
			`/* @neptune-start ${section.block} ${section.style} */`,
			section.css.trim(),
			`/* @neptune-end ${section.block} ${section.style} */`,
			'',
		);
	}
	const suffix = parsed.suffix.replace(/^\s+/u, '');
	if (suffix !== '') {
		parts.push(suffix);
	}
	return parts.join('\n').replace(/\n+$/u, '') + '\n';
}

export function upsertSection(parsed: Parsed, section: Section): Parsed {
	if (!KEY_RE.test(section.block) || !STYLE_RE.test(section.style)) {
		throw new Error(
			`Invalid section key ${section.block}::${section.style}`,
		);
	}
	const key = `${section.block}::${section.style}`;
	const next = new Map(parsed.sections);
	next.set(key, section);
	return {...parsed, sections: next};
}

function stripBoundaryNewlines(s: string): string {
	return s.replace(/^\n/u, '').replace(/\n$/u, '');
}

const dCssGet = dObject({css: dString});
const dCssSet = dObject({ok: dBoolean});

export async function readCustomCss(
	session: StudioSession,
	nameOrPath: string,
): Promise<string> {
	const result = await runNeptuneCli(
		session,
		nameOrPath,
		'custom-css-get',
		{},
		dCssGet,
	);
	return result.css;
}

export async function writeCustomCss(
	session: StudioSession,
	nameOrPath: string,
	css: string,
): Promise<void> {
	await runNeptuneCli(
		session,
		nameOrPath,
		'custom-css-set',
		{css: b64Arg(css)},
		dCssSet,
	);
}
