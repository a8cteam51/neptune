// Pure helpers that map a template filename to its block-theme role
// (header / footer / page) and on-disk subdirectory (parts / templates).
// Used by build-template and refine-template to scope agent prompts and
// to compute fallback paths when the database hasn't yet got a row for
// a given template.
//
// The actual scaffold (creating an empty wp_template / wp_template_part
// post for a freshly-pulled template) lives in lib/wp-templates.ts —
// see ensureTemplate.
const PARTS_FILES = new Set(['header.html', 'footer.html']);

export function templateSubdir(templateFile: string): 'parts' | 'templates' {
	return PARTS_FILES.has(templateFile.toLowerCase()) ? 'parts' : 'templates';
}

export type TemplateRole = 'header' | 'footer' | 'page';

export function templateRole(templateFile: string): TemplateRole {
	const f = templateFile.toLowerCase();
	if (f === 'header.html') return 'header';
	if (f === 'footer.html') return 'footer';
	return 'page';
}
