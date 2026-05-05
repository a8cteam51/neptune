// Creates an empty WordPress theme template file at
// wp-content/themes/<theme>/{templates,parts}/<file>.html if it doesn't
// already exist. parts/ is reserved for header.html and footer.html;
// everything else goes under templates/.
import {access, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {writeFileAtomic} from './atomic-write.js';

export type ScaffoldResult = {
	path: string;
	created: boolean;
};

const PARTS_FILES = new Set(['header.html', 'footer.html']);

export async function scaffoldTemplate(
	projectDir: string,
	themeSlug: string,
	templateFile: string,
): Promise<ScaffoldResult> {
	if (!templateFile.toLowerCase().endsWith('.html')) {
		throw new Error(
			`Template file must be .html (got "${templateFile}")`,
		);
	}

	const themeRoot = resolve(
		projectDir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
	);
	const subdir = PARTS_FILES.has(templateFile.toLowerCase())
		? 'parts'
		: 'templates';
	const target = resolve(themeRoot, subdir, templateFile);

	if (await fileExists(target)) {
		return {path: target, created: false};
	}

	await mkdir(dirname(target), {recursive: true});
	await writeFileAtomic(target, '');
	return {path: target, created: true};
}

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

async function fileExists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}
