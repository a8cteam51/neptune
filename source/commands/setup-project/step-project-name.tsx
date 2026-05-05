import React from 'react';
import TextStep from '../../lib/text-step.js';
import {validateProjectName} from '../../lib/validators.js';
import type {NeptuneConfig} from './types.js';

export default function ProjectNameStep({
	config,
	onComplete,
}: {
	config: NeptuneConfig;
	onComplete: (updates: Partial<NeptuneConfig>) => void;
}) {
	return (
		<TextStep
			title="Step 1 — Name your project"
			placeholder="My Neptune Project"
			initialValue={config.projectName ?? ''}
			validate={validateProjectName}
			onSubmit={value =>
				onComplete({
					projectName: value,
					steps: {...config.steps, projectNamed: true},
				})
			}
		/>
	);
}
