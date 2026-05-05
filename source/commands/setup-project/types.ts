// Shared types for project state. Two layers:
//   - NeptuneConfig: project-level, persisted in neptune-config.json
//   - PullMeta: per-pull, persisted in design/<slug>/meta.json
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
	projectNamed?: boolean;
	gitRepoConfigured?: boolean;
	themeConfigured?: boolean;
	wordpressInstalled?: boolean;
	wpContentCloned?: boolean;
	studioSiteCreated?: boolean;
};

export type SpecialPullKind = 'devHandoff' | 'styleGuide' | 'templates';

export type TitleCardRef = {
	id: string;
	name: string;
};

export type DevNote = {
	id: string;
	text?: string;
};

export type PullMeta = {
	pageName: string;
	slug: string;
	selectionName?: string;
	x?: number;
	y?: number;
	templateFile?: string;
	themeSlug?: string;
	scaffolded?: boolean;
	special?: SpecialPullKind;
	pulledAt: string;
	devNotes?: DevNote[];
	titleCards?: TitleCardRef[];
	expectedWidth?: number;
	expectedHeight?: number;
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
