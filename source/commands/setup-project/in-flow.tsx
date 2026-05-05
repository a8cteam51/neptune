import React from 'react';
import {Box} from 'ink';
import FrameTitle from './frame.js';
import StepProgress from './step-progress.js';
import ProjectNameStep from './step-project-name.js';
import GitRepoStep from './step-git-repo.js';
import ThemeStep from './step-theme.js';
import WordPressInstallStep from './step-wordpress-install.js';
import WpContentCloneStep from './step-wp-content-clone.js';
import StudioSiteStep from './step-studio-site.js';
import {nextPendingStep} from './steps-meta.js';
import type {Loaded, NeptuneConfig} from './types.js';

export default function InFlow({
	loaded,
	onAdvance,
	onAbort,
}: {
	loaded: Loaded;
	onAdvance: (updates: Partial<NeptuneConfig>) => void;
	onAbort: (message: string) => void;
}) {
	const step = nextPendingStep(loaded.config);

	return (
		<FrameTitle
			subtitle={
				loaded.mode === 'created'
					? `Initialized ${loaded.dir}`
					: `Continuing ${loaded.dir}`
			}
		>
			<StepProgress config={loaded.config} />
			<Box marginTop={1} flexDirection="column">
				{step === 'projectNamed' ? (
					<ProjectNameStep config={loaded.config} onComplete={onAdvance} />
				) : null}
				{step === 'gitRepoConfigured' ? (
					<GitRepoStep config={loaded.config} onComplete={onAdvance} />
				) : null}
				{step === 'themeConfigured' ? (
					<ThemeStep config={loaded.config} onComplete={onAdvance} />
				) : null}
				{step === 'wordpressInstalled' ? (
					<WordPressInstallStep
						projectDir={loaded.dir}
						config={loaded.config}
						onComplete={onAdvance}
						onAbort={onAbort}
					/>
				) : null}
				{step === 'wpContentCloned' ? (
					<WpContentCloneStep
						projectDir={loaded.dir}
						config={loaded.config}
						onComplete={onAdvance}
						onAbort={onAbort}
					/>
				) : null}
				{step === 'studioSiteCreated' ? (
					<StudioSiteStep
						projectDir={loaded.dir}
						config={loaded.config}
						onComplete={onAdvance}
						onAbort={onAbort}
					/>
				) : null}
			</Box>
		</FrameTitle>
	);
}
