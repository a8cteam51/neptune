// Project-config types live here; pull-level types (PullMeta,
// TitleCardRef, SpecialPullKind) live in lib/types.ts so the lib layer
// doesn't depend on commands/.
import type {AgentProvider} from '../../lib/agent-provider.js';

export type {AgentProvider} from '../../lib/agent-provider.js';

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
	createdAt: string;
	updatedAt: string;
	provider: AgentProvider;
	projectName?: string;
	gitRepo?: string;
	themeSlug?: string;
	design: {pagesDir: string};
	steps: Steps;
	variablesBuiltAt?: string;
	placeholderImage?: PlaceholderImage;
	// Pattern names (PascalCase, matching the function name in code.tsx)
	// the user picked in Extract patterns. Source of truth for which
	// patterns surface in Pull pattern. On-disk folders under
	// patterns/<Name>/ are written by Pull pattern, not by this list.
	patterns?: string[];
};

export type Loaded = {
	dir: string;
	configPath: string;
	config: NeptuneConfig;
	mode: 'created' | 'continued';
};
