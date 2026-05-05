// Reads and writes WordPress block-theme templates and template parts
// against the database (post types `wp_template` / `wp_template_part`)
// via Studio's wp_cli MCP tool. Once a post exists for a given (slug,
// theme), WP serves it instead of the theme file — so DB-first edits
// preserve user changes from the Site Editor and give us revision
// history for free.
//
// All embedded values pass through TS template literals into PHP
// double-quoted strings; we never use PHP single quotes in the snippet
// so the outer shell-single-quote wrapping needs no escape trick. The
// content body is base64-encoded to side-step any in-PHP escaping
// concerns (CSS / HTML / JSON in templates).
import {Buffer} from 'node:buffer';
import {shellSingleQuote, wpCli} from './wp-cli.js';
import type {StudioSession} from '../integrations/studio/mcp.js';
import {templateSubdir} from './template-scaffold.js';

export type TemplatePostType = 'wp_template' | 'wp_template_part';

export type TemplateTarget = {
	slug: string;
	type: TemplatePostType;
	title: string; // human-readable title for new posts
};

const SLUG_RE = /^[a-z][a-z0-9-]*$/;

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

export async function readTemplate(
	session: StudioSession,
	nameOrPath: string,
	target: TemplateTarget,
): Promise<string | null> {
	const phpCode = [
		'$posts = get_posts(array(',
		`  "post_type" => "${target.type}",`,
		'  "post_status" => "publish",',
		`  "name" => "${target.slug}",`,
		'  "numberposts" => 1,',
		'  "tax_query" => array(array(',
		'    "taxonomy" => "wp_theme",',
		'    "field" => "name",',
		'    "terms" => get_stylesheet(),',
		'  )),',
		'));',
		'if (empty($posts)) { exit; }',
		'echo base64_encode($posts[0]->post_content);',
	].join('\n');
	const out = await wpCli(
		session,
		nameOrPath,
		`eval ${shellSingleQuote(phpCode)}`,
	);
	const trimmed = out.trim();
	if (trimmed === '') return null;
	return Buffer.from(trimmed, 'base64').toString('utf8');
}

// Idempotent scaffold: creates an empty wp_template / wp_template_part
// post for the given slug + active theme if one doesn't already exist.
// Returns whether a post was created (true) or already existed (false).
// Single wp-cli call — combines the existence check and the insert in
// one PHP snippet so we don't pay the Studio MCP round-trip twice.
export async function ensureTemplate(
	session: StudioSession,
	nameOrPath: string,
	target: TemplateTarget,
): Promise<{created: boolean}> {
	const encodedTitle = Buffer.from(target.title, 'utf8').toString('base64');
	const phpCode = [
		`$title = base64_decode("${encodedTitle}");`,
		'$posts = get_posts(array(',
		`  "post_type" => "${target.type}",`,
		'  "post_status" => "publish",',
		`  "name" => "${target.slug}",`,
		'  "numberposts" => 1,',
		'  "tax_query" => array(array(',
		'    "taxonomy" => "wp_theme",',
		'    "field" => "name",',
		'    "terms" => get_stylesheet(),',
		'  )),',
		'));',
		'if (!empty($posts)) { echo "exists"; exit; }',
		'$post_id = wp_insert_post(array(',
		`  "post_type" => "${target.type}",`,
		'  "post_status" => "publish",',
		`  "post_name" => "${target.slug}",`,
		'  "post_title" => $title,',
		'  "post_content" => "",',
		'), true);',
		'if (is_wp_error($post_id) || !$post_id) { exit(1); }',
		'wp_set_object_terms($post_id, get_stylesheet(), "wp_theme", false);',
		'echo "created";',
	].join('\n');
	const out = await wpCli(
		session,
		nameOrPath,
		`eval ${shellSingleQuote(phpCode)}`,
	);
	return {created: out.trim().endsWith('created')};
}

export async function writeTemplate(
	session: StudioSession,
	nameOrPath: string,
	target: TemplateTarget,
	content: string,
): Promise<void> {
	const encodedContent = Buffer.from(content, 'utf8').toString('base64');
	const encodedTitle = Buffer.from(target.title, 'utf8').toString('base64');
	const phpCode = [
		`$content = base64_decode("${encodedContent}");`,
		`$title = base64_decode("${encodedTitle}");`,
		'$posts = get_posts(array(',
		`  "post_type" => "${target.type}",`,
		'  "post_status" => "publish",',
		`  "name" => "${target.slug}",`,
		'  "numberposts" => 1,',
		'  "tax_query" => array(array(',
		'    "taxonomy" => "wp_theme",',
		'    "field" => "name",',
		'    "terms" => get_stylesheet(),',
		'  )),',
		'));',
		'if (!empty($posts)) {',
		'  $result = wp_update_post(array(',
		'    "ID" => $posts[0]->ID,',
		'    "post_content" => $content,',
		'  ), true);',
		'  if (is_wp_error($result) || !$result) { exit(1); }',
		'} else {',
		'  $post_id = wp_insert_post(array(',
		`    "post_type" => "${target.type}",`,
		'    "post_status" => "publish",',
		`    "post_name" => "${target.slug}",`,
		'    "post_title" => $title,',
		'    "post_content" => $content,',
		'  ), true);',
		'  if (is_wp_error($post_id) || !$post_id) { exit(1); }',
		'  wp_set_object_terms($post_id, get_stylesheet(), "wp_theme", false);',
		'}',
	].join('\n');
	await wpCli(
		session,
		nameOrPath,
		`eval ${shellSingleQuote(phpCode)}`,
	);
}
