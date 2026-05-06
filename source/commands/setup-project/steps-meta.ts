// Source of truth for setup step ordering AND display labels.
// nextPendingStep walks STEP_LABELS and returns the first key in
// config.steps that isn't true. step-progress.tsx renders the same
// list. Adding a step is a one-file change here.
import type {NeptuneConfig, StepKey} from './types.js';

export const STEP_LABELS: ReadonlyArray<{key: StepKey; label: string}> = [
	{key: 'projectNamed', label: 'Project named'},
	{key: 'gitRepoConfigured', label: 'Git repo configured'},
	{key: 'themeConfigured', label: 'Theme slug configured'},
	{key: 'wordpressInstalled', label: 'WordPress installed'},
	{key: 'wpContentCloned', label: 'wp-content cloned from repo'},
	{key: 'studioSiteCreated', label: 'Studio site created'},
	{key: 'placeholderUploaded', label: 'Placeholder image uploaded'},
];

export const ORDERED_STEPS: StepKey[] = STEP_LABELS.map(s => s.key);

export function nextPendingStep(config: NeptuneConfig): StepKey | undefined {
	return ORDERED_STEPS.find(key => !config.steps[key]);
}
