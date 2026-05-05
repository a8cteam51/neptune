// Parses code.tsx files emitted by Figma's code generator to find
// top-level function declarations. Anything that is not the default
// export is treated as a reusable pattern.
//
// We brace-match by hand instead of pulling in a real TS parser:
// Figma's output is shallow and predictable, and a regex + string/
// comment-aware scanner is sufficient. Template literal `${…}`
// expressions are treated opaquely — fine for current output, may
// need revisiting if Figma starts emitting tagged templates.

export type ParsedFunction = {
	name: string;
	start: number;
	end: number;
};

export type ParsedFunctions = {
	defaultName: string | null;
	functions: ParsedFunction[];
};

const FUNC_DECL_RE =
	/^(export\s+(?:default\s+)?)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm;

const TRAILING_DEFAULT_RE =
	/^export\s+default\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*;?\s*$/m;

export function parseTopLevelFunctions(src: string): ParsedFunctions {
	let defaultName: string | null = null;
	const functions: ParsedFunction[] = [];

	FUNC_DECL_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = FUNC_DECL_RE.exec(src)) !== null) {
		const prefix = match[1] ?? '';
		const name = match[2]!;
		const isDefault = /\bdefault\b/.test(prefix);

		const parenOpen = match.index + match[0].length - 1;
		const parenClose = findMatching(src, parenOpen, '(', ')');
		if (parenClose === -1) continue;

		let i = parenClose + 1;
		while (i < src.length && src[i] !== '{') i++;
		if (i >= src.length) continue;

		const braceClose = findMatching(src, i, '{', '}');
		if (braceClose === -1) continue;

		if (isDefault) defaultName = name;
		functions.push({name, start: match.index, end: braceClose});
	}

	if (defaultName === null) {
		const m = TRAILING_DEFAULT_RE.exec(src);
		if (m && m[1]) defaultName = m[1];
	}

	return {defaultName, functions};
}

function findMatching(
	src: string,
	openIdx: number,
	open: string,
	close: string,
): number {
	let depth = 0;
	let i = openIdx;
	let mode: 'code' | 'sq' | 'dq' | 'tpl' | 'lc' | 'bc' = 'code';

	while (i < src.length) {
		const c = src[i]!;
		const n = src[i + 1];

		if (mode === 'code') {
			if (c === '/' && n === '/') {
				mode = 'lc';
				i += 2;
				continue;
			}
			if (c === '/' && n === '*') {
				mode = 'bc';
				i += 2;
				continue;
			}
			if (c === "'") {
				mode = 'sq';
				i++;
				continue;
			}
			if (c === '"') {
				mode = 'dq';
				i++;
				continue;
			}
			if (c === '`') {
				mode = 'tpl';
				i++;
				continue;
			}
			if (c === open) {
				depth++;
				i++;
				continue;
			}
			if (c === close) {
				depth--;
				if (depth === 0) return i;
				i++;
				continue;
			}
			i++;
		} else if (mode === 'sq') {
			if (c === '\\') {
				i += 2;
				continue;
			}
			if (c === "'") mode = 'code';
			i++;
		} else if (mode === 'dq') {
			if (c === '\\') {
				i += 2;
				continue;
			}
			if (c === '"') mode = 'code';
			i++;
		} else if (mode === 'tpl') {
			if (c === '\\') {
				i += 2;
				continue;
			}
			if (c === '`') mode = 'code';
			i++;
		} else if (mode === 'lc') {
			if (c === '\n') mode = 'code';
			i++;
		} else if (mode === 'bc') {
			if (c === '*' && n === '/') {
				mode = 'code';
				i += 2;
				continue;
			}
			i++;
		}
	}
	return -1;
}
