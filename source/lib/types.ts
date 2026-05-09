// Pull-level types. Lives in lib/ so design-walk.ts and the figma
// integrations don't have to reach back into commands/setup-project/.
export type SpecialPullKind = 'styleGuide' | 'templates';

export type TitleCardRef = {
	id: string;
	name: string;
};

// Per-asset record persisted in <pull>/meta.json. Records the const
// declaration in code.tsx that the WP media item replaces, so build
// agents can swap localhost:3845 references for real attachment ids
// without scanning the bytes themselves. Rasters land here directly;
// SVGs are rasterized to PNG and then land here as 'raster' once the
// triage agent judges them valuable (logos, illustrations) — decorative
// SVGs are deleted from disk and never appear in this list. See
// source/integrations/figma/assets-fetch.ts and
// source/integrations/figma/svg-triage.ts.
export type PulledAsset = {
	constName: string;
	filename: string;
	mediaId: number;
	mediaUrl: string;
	// Always 'raster' for new pulls (PNG/JPG/GIF/WEBP). 'svg' is
	// retained in the union to keep older meta.json files (recorded
	// before SVG-to-PNG rasterization landed) parseable.
	kind: 'raster' | 'svg';
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
	// PNG/JPG assets imported into the WP media library at pull time.
	// Build/refine agents read this mapping to swap code.tsx
	// localhost:3845 references for real attachment ids and URLs.
	assets?: PulledAsset[];
};
