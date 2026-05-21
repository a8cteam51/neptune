// Target builders for WordPress `page` and `post` wp_posts.
//
// The runtime read/write of these posts now lives in
// source/integrations/haydi/client.ts (readPageViaHaydi /
// writePageViaHaydi). This module is the pure-data half: turn a slug +
// pageName + post-type into a `PageTarget` that callers thread through
// to the Haydi helpers. No I/O, no PHP, no studio session.
//
// `postType` distinguishes the two canonical content surfaces:
//   - 'page' for `page.html` and most usesPostContent flows. Content is
//     written to the WordPress `page` post-type matching the slug.
//   - 'post' for `single.html`. Content is written to the WordPress
//     `post` post-type matching the slug; the canonical preview target
//     is post id 1 (the default Hello World seed post).

export type PagePostType = 'page' | 'post';

export type PageTarget = {
	slug: string;
	title: string;
	postType: PagePostType;
};

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function pageTargetFor(
	slug: string,
	pageName: string,
	postType: PagePostType = 'page',
): PageTarget {
	if (!SLUG_RE.test(slug)) {
		throw new Error(
			`Page slug "${slug}" does not match ^[a-z0-9][a-z0-9_-]*$.`,
		);
	}
	return {slug, title: pageName || defaultTitleFromSlug(slug), postType};
}

export function pageTargetLabel(target: PageTarget): string {
	return `${target.postType}:${target.slug}`;
}

export function defaultTitleFromSlug(slug: string): string {
	return slug
		.split(/[-_]/u)
		.filter(p => p.length > 0)
		.map(p => p.charAt(0).toUpperCase() + p.slice(1))
		.join(' ');
}
