// Source of truth for setup step ordering. nextPendingStep walks this
// list and returns the first key in config.steps that isn't `true`.
import type {NeptuneConfig, StepKey} from './types.js';

export const ORDERED_STEPS: StepKey[] = [
	'projectNamed',
	'gitRepoConfigured',
	'themeConfigured',
	'wordpressInstalled',
	'wpContentCloned',
	'studioSiteCreated',
];

export function nextPendingStep(config: NeptuneConfig): StepKey | undefined {
	return ORDERED_STEPS.find(key => config.steps[key] !== true);
}
