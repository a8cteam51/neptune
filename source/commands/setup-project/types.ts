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

// Which design pipeline a project uses. 'figma' (the default for every
// project created before this field existed) pulls Figma frames and runs
// the tsx-to-blocks build. 'claude-design' imports an already-near-final
// Claude Design package (theme.json + block-markup templates + style.css)
// and standardizes/refines it instead. The value re-shapes the top-level
// menu (see app.tsx buildMenuItems).
export type ProjectSource = 'figma' | 'claude-design';

// Per-import bookkeeping for the Claude Design branch. Set by the Import
// Claude Design command; absent on Figma projects.
export type ClaudeDesignState = {
	importedAt?: string;
	// Last directory the package was imported from, so a re-import can
	// default the folder picker to it.
	sourceDir?: string;
};

export type NeptuneConfig = {
	createdAt: string;
	updatedAt: string;
	projectName?: string;
	gitRepo?: string;
	themeSlug?: string;
	design: {pagesDir: string};
	steps: Steps;
	variablesBuiltAt?: string;
	// Pattern names (PascalCase, matching the function name in code.tsx)
	// the user picked in Extract patterns. Source of truth for which
	// patterns surface in Pull pattern. On-disk folders under
	// patterns/<Name>/ are written by Pull pattern, not by this list.
	patterns?: string[];
	// Design pipeline. Absent ⇒ 'figma' (back-compat). normalizeConfig
	// fills the default so callers can read it directly.
	source?: ProjectSource;
	// Claude Design import bookkeeping; only present once an import runs.
	claudeDesign?: ClaudeDesignState;
};

export type Loaded = {
	dir: string;
	configPath: string;
	config: NeptuneConfig;
	mode: 'created' | 'continued';
};
