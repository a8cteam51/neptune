// Reads and writes WordPress `page` posts via the `wp neptune page-*`
// subcommands shipped with the active theme (<theme>/inc/class-neptune-cli.php).
// Used by the post-content-aware build flow: when a design's wrapper
// embeds `wp:post-content`, the body lives in a `page` post that this
// module manages, while the wrapper itself stays in wp-templates.ts.
import {b64Arg, runNeptuneCli, strArg} from './neptune-cli.js';
import {dBoolean, dNullable, dNumber, dObject, dString} from './decode.js';
import type {StudioSession} from '../integrations/studio/mcp.js';

export type PageTarget = {
	slug: string;
	title: string;
};

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function pageTargetFor(slug: string, pageName: string): PageTarget {
	if (!SLUG_RE.test(slug)) {
		throw new Error(
			`Page slug "${slug}" does not match ^[a-z0-9][a-z0-9_-]*$.`,
		);
	}
	return {slug, title: pageName || defaultTitleFromSlug(slug)};
}

export function pageTargetLabel(target: PageTarget): string {
	return `page:${target.slug}`;
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
	id: dNullable(dNumber),
});

export type PageReadResult = {id: number; content: string} | null;

export async function readPage(
	session: StudioSession,
	nameOrPath: string,
	target: PageTarget,
): Promise<PageReadResult> {
	const result = await runNeptuneCli(
		session,
		nameOrPath,
		'page-get',
		{slug: strArg(target.slug)},
		dGetResult,
	);
	if (!result.found || result.id === null) return null;
	return {id: result.id, content: result.content ?? ''};
}

const dEnsureResult = dObject({created: dBoolean, id: dNumber});

export async function ensurePage(
	session: StudioSession,
	nameOrPath: string,
	target: PageTarget,
): Promise<{created: boolean; id: number}> {
	return runNeptuneCli(
		session,
		nameOrPath,
		'page-ensure',
		{
			slug: strArg(target.slug),
			title: b64Arg(target.title),
		},
		dEnsureResult,
	);
}

export async function writePage(
	session: StudioSession,
	nameOrPath: string,
	target: PageTarget,
	content: string,
): Promise<{id: number}> {
	const result = await runNeptuneCli(
		session,
		nameOrPath,
		'page-set',
		{
			slug: strArg(target.slug),
			title: b64Arg(target.title),
			content: b64Arg(content),
		},
		dEnsureResult,
	);
	return {id: result.id};
}
