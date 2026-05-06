// Extracts designer notes from data-development-annotations attributes
// in a Figma-generated code.tsx. Multiple notes on the same node are
// joined with " | " in Figma; we split on that and drop empty entries.
//
// The agent prompts in build-template, build-content, and refine-template
// surface these as a "=== dev annotations ===" section so the model
// gets the designer's intent as explicit context rather than mining
// it from the JSX.

const ATTR_RE = /data-development-annotations="([^"]*)"/g;
const NODE_ID_RE = /data-node-id="([^"]*)"/;

export type DevAnnotation = {
	nodeId?: string;
	notes: string[];
};

export function extractDevAnnotations(code: string): DevAnnotation[] {
	const out: DevAnnotation[] = [];
	for (const match of code.matchAll(ATTR_RE)) {
		const raw = decodeAttr(match[1] ?? '');
		const notes = raw
			.split('|')
			.map(s => s.trim())
			.filter(s => s.length > 0);
		if (notes.length === 0) continue;

		const nodeId = findNearbyNodeId(code, match.index ?? 0);
		out.push(nodeId ? {nodeId, notes} : {notes});
	}
	return out;
}

// Look for a data-node-id attribute on the same JSX element. We scan
// backwards and forwards from the annotation match to the nearest tag
// boundary; this is approximate but good enough — the React output
// from Figma keeps node-id and annotations on the same opening tag.
function findNearbyNodeId(code: string, attrStart: number): string | undefined {
	const tagStart = code.lastIndexOf('<', attrStart);
	if (tagStart < 0) return undefined;
	const tagEnd = code.indexOf('>', attrStart);
	if (tagEnd < 0) return undefined;
	const tag = code.slice(tagStart, tagEnd + 1);
	return NODE_ID_RE.exec(tag)?.[1];
}

function decodeAttr(value: string): string {
	return value
		.replaceAll('&quot;', '"')
		.replaceAll('&apos;', "'")
		.replaceAll('&amp;', '&')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>');
}

// Build the "=== dev annotations ===" prompt section. Returns an empty
// string when there are no annotations — callers can `if (text)` to
// decide whether to push it onto the section list.
export function formatDevAnnotationsSection(
	annotations: DevAnnotation[],
): string {
	if (annotations.length === 0) return '';
	const lines: string[] = [];
	lines.push(
		'These are non-binding designer notes attached to specific elements in code.tsx (data-development-annotations). Treat them as intent / context that explains why a region looks or behaves the way it does. They are not instructions to the user — they are guidance for you.',
	);
	lines.push('');
	for (const ann of annotations) {
		const header = ann.nodeId ? `On node ${ann.nodeId}:` : 'On an unidentified node:';
		lines.push(header);
		for (const note of ann.notes) {
			lines.push(`  - ${note}`);
		}
	}
	return lines.join('\n');
}
