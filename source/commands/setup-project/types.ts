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

// Haydi MCP endpoint for the project's running site. Build / refine
// commands wire this in as an MCP server so the agent can persist
// wp_post mutations (run_php, run_query) and touch site-resident files
// (write_file, edit_file). Optional: commands that don't talk to the
// site (variables build, pattern extract) never read this field.
//
// `token` is optional in the type because the setup flow auto-writes
// `url` after Studio site creation and prompts the user to paste the
// token from WP Admin → Haydi → Remote Access. Commands that USE Haydi
// must validate the token is present at the call boundary — an empty
// token here means "not yet pasted," not "no auth needed."
export type HaydiConfig = {
	// Base URL of the Studio (or other) site, e.g. http://localhost:8893.
	// `/wp-json/haydi/v1/mcp` is appended at runtime; pass the SITE URL,
	// not the MCP endpoint.
	url: string;
	// Bearer token issued in WP Admin → Haydi → Remote Access. Treat as
	// a secret; do NOT commit neptune-config.json with this field set.
	token?: string;
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
	haydi?: HaydiConfig;
};

export type Loaded = {
	dir: string;
	configPath: string;
	config: NeptuneConfig;
	mode: 'created' | 'continued';
};
