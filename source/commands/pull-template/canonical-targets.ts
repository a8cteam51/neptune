// Canonical content surfaces for the two block-theme templates that
// ship with a default post / page in a fresh WordPress install.
//
// `forced: true` means the configure step writes the canonical values
// verbatim and skips all later prompts (slug, previewPath). single.html
// is forced because it always renders the seed Hello World post (id 1):
// the user has no reason to point single.html at a different post
// during preview, and letting them do so risks creating a duplicate
// "Hello World" page that shadows the seed post.
//
// `forced: false` means the canonical values are pre-filled defaults
// the user can still override at the previewPath stage. page.html uses
// the seed Sample Page as a convenient default, but multiple page.html
// pulls are expected (e.g. About, Contact, Services all share the
// page.html wrapper); the first pull anchors the wrapper, subsequent
// pulls must target their own distinct wp_posts.
import type {PagePostType} from '../../lib/wp-pages.js';

export type CanonicalTarget = {
	pageSlug: string;
	postType: PagePostType;
	previewPath: string;
	// When true, the configure step submits these values verbatim and
	// skips the usesPostContent / pageSlug / previewPath stages.
	// When false, the values pre-fill the corresponding stages and the
	// user can still adjust them before submitting.
	forced: boolean;
};

const CANONICAL_TARGETS: Record<string, CanonicalTarget> = {
	'single.html': {
		pageSlug: 'hello-world',
		postType: 'post',
		previewPath: '/?p=1',
		forced: true,
	},
	'page.html': {
		pageSlug: 'sample-page',
		postType: 'page',
		previewPath: '/sample-page',
		forced: false,
	},
};

export function canonicalTargetFor(
	templateFile: string,
): CanonicalTarget | null {
	return CANONICAL_TARGETS[templateFile.toLowerCase()] ?? null;
}
