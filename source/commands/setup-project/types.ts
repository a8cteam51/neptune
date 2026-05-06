// Project-config types live here; pull-level types (PullMeta,
// TitleCardRef, SpecialPullKind) live in lib/types.ts so the lib layer
// doesn't depend on commands/.
export const CONFIG_FILENAME = 'neptune-config.json';

export type StepKey =
	| 'projectNamed'
	| 'gitRepoConfigured'
	| 'themeConfigured'
	| 'wordpressInstalled'
	| 'wpContentCloned'
	| 'studioSiteCreated'
	| 'placeholderUploaded';

export type Steps = {
	initialized: boolean;
	projectNamed: boolean;
	gitRepoConfigured: boolean;
	themeConfigured: boolean;
	wordpressInstalled: boolean;
	wpContentCloned: boolean;
	studioSiteCreated: boolean;
	placeholderUploaded: boolean;
};

// Single placeholder attachment uploaded during setup. build-template
// and refine-template inject this into agent prompts so any wp:image
// block resolves to a real, viewable asset instead of an empty src.
export type PlaceholderImage = {
	id: number;
	url: string;
};

export type NeptuneConfig = {
	version: 1;
	createdAt: string;
	updatedAt: string;
	projectName?: string;
	gitRepo?: string;
	themeSlug?: string;
	design: {pagesDir: string};
	steps: Steps;
	variablesBuiltAt?: string;
	placeholderImage?: PlaceholderImage;
};

export type Loaded = {
	dir: string;
	configPath: string;
	config: NeptuneConfig;
	mode: 'created' | 'continued';
};

// Re-exports for backwards-compatibility — preferred import is lib/types.js.
export type {
	PullMeta,
	SpecialPullKind,
	TitleCardRef,
} from '../../lib/types.js';
