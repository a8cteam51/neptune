import React from 'react';
import EventStep from '../../lib/event-step.js';
import {cloneWpContent} from '../../integrations/wordpress/content-clone.js';
import type {NeptuneConfig} from './types.js';

export default function WpContentCloneStep({
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
			title="Step 5 — Clone wp-content from repo"
			start={async signal => {
				if (!config.gitRepo) {
					throw new Error(
						'Git repo missing from config; cannot clone wp-content.',
					);
				}
				return cloneWpContent(projectDir, config.gitRepo, {signal});
			}}
			onSuccess={() =>
				onComplete({
					steps: {...config.steps, wpContentCloned: true},
				})
			}
			onAbort={onAbort}
		/>
	);
}
