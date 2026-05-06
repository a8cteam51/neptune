// Pull-level types. Lives in lib/ so design-walk.ts and the figma
// integrations don't have to reach back into commands/setup-project/.
export type SpecialPullKind = 'styleGuide' | 'templates';

export type TitleCardRef = {
	id: string;
	name: string;
};

export type PullMeta = {
	pageName: string;
	slug: string;
	selectionName?: string;
	x?: number;
	y?: number;
	templateFile?: string;
	previewPath?: string;
	themeSlug?: string;
	scaffolded?: boolean;
	special?: SpecialPullKind;
	// True when the design's wrapper embeds the page body via
	// `wp:post-content`. The seam in code.tsx is marked with
	// data-neptune-annotations="post-content"; build-template emits the
	// wrapper around a `wp:post-content` placeholder, build-content
	// converts the marked subtree into a wp_post.
	usesPostContent?: boolean;
	// WP page slug that hosts the post-content body. Defaults to the
	// pull slug at configure time but can diverge (e.g. homepage pull
	// "default-page-template" → page slug "home").
	pageSlug?: string;
	// wp_post ID resolved at pull time via page-ensure. Stored so
	// downstream commands don't have to re-resolve.
	pageId?: number;
	// True when this pull does not own its templateFile's wrapper —
	// another pull was first to claim the same templateFile, so this
	// pull only contributes post-content. build-template skips it.
	contentOnly?: boolean;
	pulledAt: string;
	titleCards?: TitleCardRef[];
	expectedWidth?: number;
	expectedHeight?: number;
};
