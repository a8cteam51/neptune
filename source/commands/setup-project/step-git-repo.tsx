import React from 'react';
import TextStep from '../../lib/text-step.js';
import {validateGitRepo} from '../../lib/validators.js';
import type {NeptuneConfig} from './types.js';

export default function GitRepoStep({
	config,
	onComplete,
}: {
	config: NeptuneConfig;
	onComplete: (updates: Partial<NeptuneConfig>) => void;
}) {
	return (
		<TextStep
			title="Step 2 — Project Git repo"
			hint="HTTPS or SSH URL."
			placeholder="git@github.com:org/repo.git"
			initialValue={config.gitRepo ?? ''}
			validate={validateGitRepo}
			onSubmit={value =>
				onComplete({
					gitRepo: value,
					steps: {...config.steps, gitRepoConfigured: true},
				})
			}
		/>
	);
}
