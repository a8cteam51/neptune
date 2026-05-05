import React from 'react';
import EventStep from '../../lib/event-step.js';
import {createStudioSite} from '../../integrations/studio/site.js';
import type {NeptuneConfig} from './types.js';

export default function StudioSiteStep({
	projectDir,
	config,
	onComplete,
	onAbort,
}: {
	projectDir: string;
	config: NeptuneConfig;
	onComplete: (updates: Partial<NeptuneConfig>) => void;
	onAbort: (message: string) => void;
}) {
	return (
		<EventStep
			title="Step 6 — Spin up Studio site"
			start={async () => {
				if (!config.projectName) {
					throw new Error(
						'Project name missing from config; cannot name Studio site.',
					);
				}
				if (!config.themeSlug) {
					throw new Error(
						'Theme slug missing from config; cannot activate theme.',
					);
				}
				return createStudioSite(
					projectDir,
					config.projectName,
					config.themeSlug,
				);
			}}
			onSuccess={() =>
				onComplete({
					steps: {...config.steps, studioSiteCreated: true},
				})
			}
			onAbort={onAbort}
		/>
	);
}
