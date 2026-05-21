import React, {useRef} from 'react';
import EventStep from '../../lib/event-step.js';
import type {LogEvent} from '../../lib/event-list.js';
import {
	createStudioSite,
	findProjectSite,
} from '../../integrations/studio/site.js';
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
	// Captured by the post-creation step in `start`, then read at
	// success time so we can write haydi.url into neptune-config.json
	// alongside the steps update. Uses a ref because EventStep's
	// onSuccess takes no args.
	const resolvedSiteUrl = useRef<string | undefined>(undefined);

	return (
		<EventStep
			title="Step 6 — Spin up Studio site"
			start={async signal => {
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
				return composeStudioSetup(
					projectDir,
					config.projectName,
					config.themeSlug,
					signal,
					url => {
						resolvedSiteUrl.current = url;
					},
					config.haydi?.token,
				);
			}}
			onSuccess={() => {
				const updates: Partial<NeptuneConfig> = {
					steps: {...config.steps, studioSiteCreated: true},
				};
				const url = resolvedSiteUrl.current;
				if (url) {
					// Preserve any token the user has already pasted in.
					updates.haydi = config.haydi?.token
						? {url, token: config.haydi.token}
						: {url};
				}
				onComplete(updates);
			}}
			onAbort={onAbort}
		/>
	);
}

// Composes the Studio site bring-up (create + plugins + theme activate)
// with the Haydi auto-config tail: resolve the site URL via `studio
// site list` and emit a prominent reminder when the user still has to
// paste the Bearer token. The URL itself lands in neptune-config.json
// at onSuccess; the reminder is purely UI.
async function* composeStudioSetup(
	projectDir: string,
	projectName: string,
	themeSlug: string,
	signal: AbortSignal,
	onUrlResolved: (url: string) => void,
	existingToken: string | undefined,
): AsyncGenerator<LogEvent> {
	yield* createStudioSite(projectDir, projectName, themeSlug, {signal});

	yield {kind: 'step', message: 'Resolving Studio site URL for haydi config…'};
	let site;
	try {
		site = await findProjectSite(projectDir, {signal});
	} catch (err) {
		yield {
			kind: 'warn',
			message: `Could not list Studio sites to read URL (${
				err instanceof Error ? err.message : String(err)
			}). Add haydi.url to neptune-config.json manually.`,
		};
		return;
	}
	if (!site) {
		yield {
			kind: 'warn',
			message:
				'Studio site created but did not appear in `studio site list`. Add haydi.url to neptune-config.json manually.',
		};
		return;
	}

	onUrlResolved(site.url);
	yield {
		kind: 'success',
		message: `Will write haydi.url = ${site.url} to neptune-config.json`,
	};

	if (existingToken) {
		yield {
			kind: 'step',
			message: 'Existing haydi.token preserved from project config.',
		};
		return;
	}

	yield {
		kind: 'warn',
		message:
			'ACTION REQUIRED — Haydi Bearer token is not set. Build / refine commands need it to persist to the running site. Steps:',
	};
	yield {
		kind: 'warn',
		message: '  1. Open the site in WP Admin (Studio → this site → WP Admin).',
	};
	yield {
		kind: 'warn',
		message: '  2. Install + activate haydi + haydi-full-extensions if needed.',
	};
	yield {
		kind: 'warn',
		message:
			'  3. Go to Haydi → Remote Access, generate a token, and paste it into neptune-config.json under haydi.token.',
	};
}
