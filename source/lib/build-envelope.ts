// JSON recovery for agent responses that should be a single JSON
// object but occasionally arrive wrapped in prose. Only used by the
// visual-diff phase of refine (which still returns a structured diff
// report — the host needs the per-diff list to drive the user-approval
// UI, so a clean JSON envelope is the natural shape there). Every
// other build / refine path now persists via tools and emits a terse
// plaintext summary; this module's smaller, narrower surface reflects
// that.

export function parseAgentJson(input: string, label: string): unknown {
	try {
		return JSON.parse(input);
	} catch (strictErr) {
		// Models occasionally violate the skill's "JSON only" contract by
		// wrapping the envelope in prose ("Looking at the diff report…")
		// or appending a trailing summary after the closing brace. Recover
		// by extracting every top-level balanced `{…}` substring and
		// returning the LARGEST one that parses — the real envelope is
		// always far bigger than any prose-embedded JSON snippet.
		// Falls through to the original strict-parse error when no
		// candidate parses.
		const candidates = extractBalancedObjects(input);
		let best: {raw: string; parsed: unknown} | undefined;
		for (const raw of candidates) {
			try {
				const parsed = JSON.parse(raw);
				if (!best || raw.length > best.raw.length) {
					best = {raw, parsed};
				}
			} catch {
				// Try the next candidate.
			}
		}
		if (best) return best.parsed;
		throw new Error(
			`${label} response was not valid JSON: ${
				strictErr instanceof Error ? strictErr.message : String(strictErr)
			}\n\nFirst 500 chars: ${input.slice(0, 500)}`,
		);
	}
}

// Walks the input character by character to find every top-level
// `{…}` substring whose braces balance, with proper string and escape
// handling so braces inside JSON string values do not affect depth.
// Used as the fallback when an agent emits prose around its JSON.
function extractBalancedObjects(input: string): string[] {
	const out: string[] = [];
	let i = 0;
	while (i < input.length) {
		if (input[i] !== '{') {
			i++;
			continue;
		}
		let depth = 0;
		let inString = false;
		let escape = false;
		let closed = false;
		let j = i;
		for (; j < input.length; j++) {
			const c = input[j]!;
			if (escape) {
				escape = false;
				continue;
			}
			if (inString) {
				if (c === '\\') escape = true;
				else if (c === '"') inString = false;
				continue;
			}
			if (c === '"') inString = true;
			else if (c === '{') depth++;
			else if (c === '}') {
				depth--;
				if (depth === 0) {
					out.push(input.slice(i, j + 1));
					i = j + 1;
					closed = true;
					break;
				}
			}
		}
		if (!closed) i++;
	}
	return out;
}
