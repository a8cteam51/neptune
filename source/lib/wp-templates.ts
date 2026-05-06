// Reads and writes WordPress block-theme templates and template parts
// against the database (post types `wp_template` / `wp_template_part`)
// via the `wp neptune template-*` subcommands shipped with the active
// theme (<theme>/inc/class-neptune-cli.php). Once a post exists for a
// given (slug, theme), WP serves it instead of the theme file — so
// DB-first edits preserve user changes from the Site Editor and give
// us revision history for free.
import {b64Arg, runNeptuneCli, strArg} from './neptune-cli.js';
import {dBoolean, dNullable, dObject, dString} from './decode.js';
import type {StudioSession} from '../integrations/studio/mcp.js';
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

const dGetResult = dObject({
	found: dBoolean,
	content: dNullable(dString),
});

export async function readTemplate(
	session: StudioSession,
	nameOrPath: string,
	target: TemplateTarget,
): Promise<string | null> {
	const result = await runNeptuneCli(
		session,
		nameOrPath,
		'template-get',
		{
			type: strArg(target.type),
			slug: strArg(target.slug),
		},
		dGetResult,
	);
	if (!result.found) return null;
	return result.content ?? '';
}

const dEnsureResult = dObject({created: dBoolean});

export async function ensureTemplate(
	session: StudioSession,
	nameOrPath: string,
	target: TemplateTarget,
): Promise<{created: boolean}> {
	const result = await runNeptuneCli(
		session,
		nameOrPath,
		'template-ensure',
		{
			type: strArg(target.type),
			slug: strArg(target.slug),
			title: b64Arg(target.title),
		},
		dEnsureResult,
	);
	return {created: result.created};
}

export async function writeTemplate(
	session: StudioSession,
	nameOrPath: string,
	target: TemplateTarget,
	content: string,
): Promise<void> {
	await runNeptuneCli(
		session,
		nameOrPath,
		'template-set',
		{
			type: strArg(target.type),
			slug: strArg(target.slug),
			title: b64Arg(target.title),
			content: b64Arg(content),
		},
		dEnsureResult,
	);
}
