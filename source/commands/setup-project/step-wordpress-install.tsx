import React from 'react';
import EventStep from '../../lib/event-step.js';
import {installWordPress} from '../../integrations/wordpress/install.js';
import type {NeptuneConfig} from './types.js';

export default function WordPressInstallStep({
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
			title="Step 4 — Install WordPress"
			start={async () => installWordPress(projectDir)}
			onSuccess={() =>
				onComplete({
					steps: {...config.steps, wordpressInstalled: true},
				})
			}
			onAbort={onAbort}
		/>
	);
}
