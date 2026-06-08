// Deterministic block-markup cleanup applied to every template/part on
// import. Claude Design packages annotate their markup with plain HTML
// comments (`<!-- THE LOOP -->`, `<!-- THEME SWITCH -->`, `<!-- reading
// time… -->`). Those are NOT Gutenberg block delimiters; the block parser
// treats them as freeform/invalid content, which dirties the block tree
// and triggers "this block contains unexpected or invalid content" in the
// editor. The standardize-theme skill is told to strip them, but we also
// enforce it here so a clean result never depends on LLM compliance.
//
// Block delimiters — `<!-- wp:… -->`, `<!-- wp:… /-->`, `<!-- /wp:… -->`
// — are preserved; every other HTML comment is removed.

// True when the comment body (the text between <!-- and -->) is a
// Gutenberg block delimiter and must be kept.
function isBlockDelimiter(inner: string): boolean {
	const t = inner.trim();
	return t.startsWith('wp:') || t.startsWith('/wp:');
}

export function stripNonBlockComments(html: string): string {
	const withoutComments = html.replace(
		/<!--([\s\S]*?)-->/g,
		(match, inner: string) => (isBlockDelimiter(inner) ? match : ''),
	);
	// Removing a comment that sat alone on a line leaves a whitespace-only
	// line behind. Blank those out, then collapse runs of blank lines to a
	// single one so the markup stays tidy. Real (non-blank) lines keep
	// their original indentation.
	return withoutComments
		.split('\n')
		.map(line => (line.trim() === '' ? '' : line))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n');
}
