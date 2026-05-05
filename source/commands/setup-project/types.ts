// Project-config types live here; pull-level types (PullMeta, DevNote,
// TitleCardRef, SpecialPullKind) live in lib/types.ts so the lib layer
// doesn't depend on commands/.
export const CONFIG_FILENAME = 'neptune-config.json';

export type StepKey =
	| 'projectNamed'
	| 'gitRepoConfigured'
	| 'themeConfigured'
	| 'wordpressInstalled'
	| 'wpContentCloned'
	| 'studioSiteCreated';

export type Steps = {
	initialized: boolean;
	projectNamed: boolean;
	gitRepoConfigured: boolean;
	themeConfigured: boolean;
	wordpressInstalled: boolean;
	wpContentCloned: boolean;
	studioSiteCreated: boolean;
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
};

export type Loaded = {
	dir: string;
	configPath: string;
	config: NeptuneConfig;
	mode: 'created' | 'continued';
};

// Re-exports for backwards-compatibility — preferred import is lib/types.js.
export type {
	DevNote,
	PullMeta,
	SpecialPullKind,
	TitleCardRef,
} from '../../lib/types.js';
