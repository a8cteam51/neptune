// Target builders for WordPress block-theme templates / template parts.
//
// The runtime read/write of `wp_template` and `wp_template_part` posts
// now lives in source/integrations/haydi/client.ts (readTemplateViaHaydi
// / writeTemplateViaHaydi). This module is the pure-data half: turn a
// templateFile + pageName into a `TemplateTarget` that callers thread
// through to the Haydi helpers. No I/O, no PHP, no studio session.
import {templateSubdir} from './template-scaffold.js';

export type TemplatePostType = 'wp_template' | 'wp_template_part';

export type TemplateTarget = {
	slug: string;
	type: TemplatePostType;
	title: string; // human-readable title for new posts
};

// Allow leading digit so canonical block-theme templates like 404.html
// produce a valid slug. Underscores accepted since defaultTitleFromSlug
// already splits on them.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function templateTargetFor(
	templateFile: string,
	pageName: string,
): TemplateTarget {
	const slug = templateFile.replace(/\.html$/i, '');
	if (!SLUG_RE.test(slug)) {
		throw new Error(
			`Template file ${templateFile} does not produce a valid slug.`,
		);
	}
	const subdir = templateSubdir(templateFile);
	const type: TemplatePostType =
		subdir === 'parts' ? 'wp_template_part' : 'wp_template';
	return {slug, type, title: pageName || defaultTitleFromSlug(slug)};
}

export function targetLabel(target: TemplateTarget): string {
	return `${target.type}:${target.slug}`;
}

export function defaultTitleFromSlug(slug: string): string {
	return slug
		.split(/[-_]/u)
		.filter(p => p.length > 0)
		.map(p => p.charAt(0).toUpperCase() + p.slice(1))
		.join(' ');
}
