// Pure pre-flight check for the End-to-end build orchestrator. Lives
// here (not inside e2e.tsx) so it can be unit-tested without dragging
// the React component tree.
//
// Returns:
//   - `missing`: human-readable strings for each unmet prerequisite.
//     The orchestrator surfaces these on the gated screen.
//   - `plan`: every pull/source the run will operate on, partitioned
//     by phase. Missing prereqs do not zero the plan — they just stop
//     the user from confirming. The plan is sorted with header.html /
//     footer.html first via sortByTemplatePriority.
import {listPulls, sortByTemplatePriority} from '../lib/design-walk.js';
import {listPatternSources, type PatternSource} from '../lib/patterns.js';
import type {Loaded} from './setup-project/types.js';
import type {PullMeta} from '../lib/types.js';

export type ContentPull = PullMeta & {
	pageSlug: string;
	templateFile: string;
};

export type TemplatePull = PullMeta & {templateFile: string};

export type Plan = {
	patternSources: PatternSource[];
	contentPulls: ContentPull[];
	templatePulls: TemplatePull[];
};

export type PrereqResult = {
	missing: string[];
	plan: Plan;
};

export async function checkPrereqs(loaded: Loaded): Promise<PrereqResult> {
	const missing: string[] = [];
	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) missing.push('themeSlug missing from neptune-config.');

	const pulls = await listPulls(loaded.dir);
	const nonSpecial = pulls.filter(p => p.special === undefined);
	if (nonSpecial.length === 0) {
		missing.push('No non-special pulls on disk — run Pull template first.');
	}

	// Each chosen pattern must already be PULLED — i.e. its TSX source
	// is on disk under patterns/<Name>/code.tsx. E2E itself runs
	// build-patterns for them (after building theme.json), so we don't
	// require the PHP output to exist yet.
	const selected = loaded.config.patterns ?? [];
	const allPatternSources = await listPatternSources(loaded.dir);
	const sourceByName = new Map(allPatternSources.map(s => [s.name, s]));
	const patternSources: PatternSource[] = [];
	for (const name of selected) {
		const src = sourceByName.get(name);
		if (!src) {
			missing.push(
				`Pattern "${name}" has not been pulled — run Pull pattern for it.`,
			);
			continue;
		}
		patternSources.push(src);
	}

	const templatePulls: TemplatePull[] = nonSpecial
		.filter(
			(p): p is TemplatePull =>
				p.contentOnly !== true &&
				typeof p.templateFile === 'string' &&
				p.templateFile.length > 0,
		)
		.slice();

	const contentPulls: ContentPull[] = nonSpecial
		.filter(
			(p): p is ContentPull =>
				p.usesPostContent === true &&
				typeof p.pageSlug === 'string' &&
				p.pageSlug.length > 0 &&
				typeof p.templateFile === 'string' &&
				p.templateFile.length > 0,
		)
		.slice();

	return {
		missing,
		plan: {
			patternSources,
			contentPulls: sortByTemplatePriority(contentPulls),
			templatePulls: sortByTemplatePriority(templatePulls),
		},
	};
}
