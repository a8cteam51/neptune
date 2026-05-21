// Top-level menu. Items are gated by what's been done; sections appear
// in user-flow order: Figma → Styles → Patterns → Content → Templates
// → End-to-end. A section is omitted entirely when none of its rows
// pass their gate, so the cursor never lands on an empty group.
//
// Gating cheat-sheet:
//   - Pull template          : active project
//   - Verify screenshots     : ≥ 1 non-special pull
//   - Build theme.json       : ≥ 1 pull + themeSlug
//   - Extract patterns       : ≥ 1 non-special pull
//   - Pull pattern           : config.patterns has ≥ 1 entry
//   - Build patterns         : ≥ 1 patterns/<Name>/code.tsx + themeSlug
//   - Build / Refine content : ≥ 1 usesPostContent pull + themeSlug
//   - Build / Refine templates, View template diff : ≥ 1 non-special pull + themeSlug
//   - End-to-end build       : ≥ 1 non-special pull + themeSlug (in-screen
//     prereq check enforces "every selected pattern is pulled")
import React, {useEffect, useState} from 'react';
import {Box, Text, useApp} from 'ink';
import SectionedMenu, {type SectionedItem} from './lib/sectioned-menu.js';
import PullTemplate from './commands/pull-template.js';
import ExtractPatterns from './commands/extract-patterns.js';
import PullPattern from './commands/pull-pattern.js';
import VerifyScreenshots from './commands/verify-screenshots.js';
import BuildTemplates from './commands/build-templates.js';
import BuildContents from './commands/build-contents.js';
import BuildPatterns from './commands/build-patterns.js';
import RefineTemplates from './commands/refine-templates.js';
import RefineContents from './commands/refine-contents.js';
import ViewTemplateDiff from './commands/view-template-diff.js';
import BuildThemeJson from './commands/build-theme-json.js';
import CaptureScreens from './commands/capture-screens.js';
import E2E from './commands/e2e.js';
import SetupProject, {type Loaded} from './commands/setup-project.js';
import {loadOrInit} from './commands/setup-project/config.js';
import {listPulls} from './lib/design-walk.js';
import {listPatternSources} from './lib/patterns.js';
import {
	getStudioSiteStatus,
	type SiteStatus,
} from './integrations/studio/site.js';

type Props = {
	name?: string;
	startCwd?: string;
};

type View =
	| 'menu'
	| 'setup'
	| 'pull'
	| 'extractPatterns'
	| 'pullPattern'
	| 'buildPatterns'
	| 'verifyScreenshots'
	| 'buildTemplates'
	| 'buildContents'
	| 'refineContents'
	| 'refineTemplates'
	| 'viewTemplateDiff'
	| 'buildTheme'
	| 'e2e'
	| 'captureScreens';

type MenuValue = View | 'quit';

export default function App({name, startCwd}: Props) {
	const {exit} = useApp();
	const [view, setView] = useState<View>('menu');
	const [activeProject, setActiveProject] = useState<Loaded | null>(null);
	const [projectVersion, setProjectVersion] = useState(0);
	const [hasPulls, setHasPulls] = useState(false);
	const [hasNonSpecialPulls, setHasNonSpecialPulls] = useState(false);
	const [hasPostContentPulls, setHasPostContentPulls] = useState(false);
	const [hasPatternSources, setHasPatternSources] = useState(false);
	const [autoLoadError, setAutoLoadError] = useState<string | null>(null);
	const [autoLoaded, setAutoLoaded] = useState(false);
	const [siteStatus, setSiteStatus] = useState<'pending' | SiteStatus | null>(
		null,
	);
	const hasTheme = Boolean(activeProject?.config.themeSlug);

	useEffect(() => {
		if (!startCwd || autoLoaded) return;
		setAutoLoaded(true);
		loadOrInit(startCwd)
			.then(loaded => {
				if (loaded.mode === 'continued') {
					setActiveProject(loaded);
				}
			})
			.catch(err => {
				setAutoLoadError(err instanceof Error ? err.message : String(err));
			});
	}, [startCwd, autoLoaded]);

	useEffect(() => {
		if (!activeProject) {
			setHasPulls(false);
			setHasNonSpecialPulls(false);
			setHasPostContentPulls(false);
			setHasPatternSources(false);
			return;
		}
		let cancelled = false;
		listPulls(activeProject.dir)
			.then(pulls => {
				if (cancelled) return;
				setHasPulls(pulls.length > 0);
				setHasNonSpecialPulls(pulls.some(p => p.special === undefined));
				setHasPostContentPulls(
					pulls.some(
						p =>
							p.special === undefined &&
							p.usesPostContent === true &&
							typeof p.pageSlug === 'string' &&
							p.pageSlug.length > 0,
					),
				);
			})
			.catch(() => {
				if (!cancelled) {
					setHasPulls(false);
					setHasNonSpecialPulls(false);
					setHasPostContentPulls(false);
				}
			});
		listPatternSources(activeProject.dir)
			.then(sources => {
				if (cancelled) return;
				setHasPatternSources(sources.length > 0);
			})
			.catch(() => {
				if (!cancelled) setHasPatternSources(false);
			});
		return () => {
			cancelled = true;
		};
	}, [activeProject, projectVersion]);

	useEffect(() => {
		if (!activeProject) {
			setSiteStatus(null);
			return;
		}
		setSiteStatus('pending');
		const controller = new AbortController();
		getStudioSiteStatus(activeProject.dir, {signal: controller.signal})
			.then(status => {
				if (!controller.signal.aborted) setSiteStatus(status);
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setSiteStatus({state: 'unknown', reason: 'probe failed'});
				}
			});
		return () => controller.abort();
	}, [activeProject, projectVersion]);

	const hasSelectedPatterns = (activeProject?.config.patterns?.length ?? 0) > 0;

	const items = buildMenuItems({
		hasActive: Boolean(activeProject),
		hasPulls,
		hasNonSpecialPulls,
		hasPostContentPulls,
		hasSelectedPatterns,
		hasPatternSources,
		hasTheme,
	});

	const handleSelect = (value: MenuValue) => {
		if (value === 'quit') {
			exit();
			return;
		}
		setView(value);
	};

	const refreshActiveProject = async () => {
		if (!activeProject) return;
		try {
			const refreshed = await loadOrInit(activeProject.dir);
			setActiveProject(refreshed);
		} catch {
			/* keep stale state on error */
		}
		setProjectVersion(v => v + 1);
	};

	const onChildDone = (refresh = false) => {
		setView('menu');
		if (refresh) void refreshActiveProject();
	};

	if (view !== 'menu') {
		const child = renderView(view, activeProject, onChildDone, project =>
			setActiveProject(project),
		);
		if (child) return child;
	}

	return (
		<Box flexDirection="column" padding={1}>
			<Box
				borderStyle="round"
				borderColor="cyan"
				paddingX={2}
				paddingY={1}
				flexDirection="row"
				alignItems="center"
			>
				<Box flexDirection="row" marginRight={4}>
					<Box flexDirection="column" marginRight={2}>
						<Text color="cyan" bold>
							{'  ^  ^  ^ '}
						</Text>
						<Text color="cyan" bold>
							{'  |  |  | '}
						</Text>
						<Text color="cyan" bold>
							{'   \\_|_/   '}
						</Text>
						<Text color="cyan" bold>
							{'     |     '}
						</Text>
						<Text color="cyan" bold>
							{'     |    '}
						</Text>
						<Text color="cyan" bold>
							{'     |    '}
						</Text>
					</Box>
					<Box flexDirection="column">
						<Text color="cyan" bold>
							{'    _   __           __                  '}
						</Text>
						<Text color="cyan" bold>
							{'   / | / /__  ____  / /___  ______  ___  '}
						</Text>
						<Text color="cyan" bold>
							{'  /  |/ / _ \\/ __ \\/ __/ / / / __ \\/ _ \\ '}
						</Text>
						<Text color="cyan" bold>
							{' / /|  /  __/ /_/ / /_/ /_/ / / / /  __/ '}
						</Text>
						<Text color="cyan" bold>
							{'/_/ |_/\\___/ .___/\\__/\\__,_/_/ /_/\\___/  '}
						</Text>
						<Text color="cyan" bold>
							{'          /_/                            '}
						</Text>
					</Box>
				</Box>
				<Box flexDirection="column">
					<Text>
						Welcome to{' '}
						<Text color="cyan" bold>
							Neptune
						</Text>
						{name ? (
							<>
								,{' '}
								<Text color="green" bold>
									{name}
								</Text>
							</>
						) : (
							''
						)}
						.
					</Text>
					{activeProject ? (
						<Text>
							Active project:{' '}
							<Text color="green" bold>
								{activeProject.config.projectName ?? activeProject.dir}
							</Text>
						</Text>
					) : (
						<Text dimColor>No active project — run Setup / Load Project.</Text>
					)}
					{activeProject ? <SiteStatusLine status={siteStatus} /> : null}
					{activeProject ? (
						<HaydiTokenWarning haydi={activeProject.config.haydi} />
					) : null}
					{autoLoadError ? <Text color="yellow">{autoLoadError}</Text> : null}
				</Box>
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text bold>What would you like to do?</Text>
				<Box marginTop={1}>
					<SectionedMenu items={items} onSelect={handleSelect} />
				</Box>
			</Box>
		</Box>
	);
}

function SiteStatusLine({status}: {status: 'pending' | SiteStatus | null}) {
	if (status === null || status === 'pending') {
		return <Text dimColor>Studio site: checking…</Text>;
	}
	if (status.state === 'running') {
		return (
			<Text>
				Studio site:{' '}
				<Text color="green" bold>
					● running
				</Text>{' '}
				<Text dimColor>({status.url})</Text>
			</Text>
		);
	}
	if (status.state === 'stopped') {
		return (
			<Text>
				Studio site:{' '}
				<Text color="yellow" bold>
					● stopped
				</Text>{' '}
				<Text dimColor>
					({status.url}). Start it in Studio to use Pull / Build / Refine.
				</Text>
			</Text>
		);
	}
	return (
		<Text>
			Studio site:{' '}
			<Text color="yellow" bold>
				● unknown
			</Text>{' '}
			<Text dimColor>{status.reason}</Text>
		</Text>
	);
}

// Surfaces a prominent "you forgot the haydi token" warning on the
// main menu so the user can't silently land in a state where every
// build / refine command will fail with the same auth error. Renders
// nothing when haydi config is fully populated OR entirely absent
// (the latter being a "haven't run setup yet" state, surfaced
// elsewhere).
function HaydiTokenWarning({
	haydi,
}: {
	haydi: import('./commands/setup-project/types.js').HaydiConfig | undefined;
}) {
	if (!haydi || haydi.token) return null;
	return (
		<Text color="yellow">
			Haydi token: <Text bold>missing</Text> — paste the Bearer token from WP
			Admin → Haydi → Remote Access into neptune-config.json under{' '}
			<Text bold>haydi.token</Text>. Build / refine commands will fail until
			this is set.
		</Text>
	);
}

// Menu items are partitioned into top-level sections in user-flow
// order: Figma → Styles → Patterns → Content → Templates → End-to-end.
// The section header itself is non-selectable; arrow keys jump straight
// from one selectable row to the next. Sections that have no available
// actions for the current project state are omitted entirely so the
// cursor never lands on an empty group.
function buildMenuItems({
	hasActive,
	hasPulls,
	hasNonSpecialPulls,
	hasPostContentPulls,
	hasSelectedPatterns,
	hasPatternSources,
	hasTheme,
}: {
	hasActive: boolean;
	hasPulls: boolean;
	hasNonSpecialPulls: boolean;
	hasPostContentPulls: boolean;
	hasSelectedPatterns: boolean;
	hasPatternSources: boolean;
	hasTheme: boolean;
}): SectionedItem<MenuValue>[] {
	const items: SectionedItem<MenuValue>[] = [];

	if (!hasActive) {
		items.push({
			kind: 'item',
			key: 'setup',
			label: 'Setup / Load Project',
			value: 'setup',
		});
		pushSection(items, 'Quit', [
			{kind: 'item', key: 'quit', label: 'Sail away', value: 'quit'},
		]);
		return items;
	}

	const figmaItems: SectionedItem<MenuValue>[] = [
		{kind: 'item', key: 'pull', label: 'Pull template', value: 'pull'},
	];
	if (hasNonSpecialPulls) {
		figmaItems.push({
			kind: 'item',
			key: 'verifyScreenshots',
			label: 'Verify screenshots',
			value: 'verifyScreenshots',
		});
	}

	const stylesItems: SectionedItem<MenuValue>[] = [];
	if (hasPulls && hasTheme) {
		stylesItems.push({
			kind: 'item',
			key: 'buildTheme',
			label: 'Build theme.json',
			value: 'buildTheme',
		});
	}

	const patternItems: SectionedItem<MenuValue>[] = [];
	if (hasNonSpecialPulls) {
		patternItems.push({
			kind: 'item',
			key: 'extractPatterns',
			label: 'Extract patterns',
			value: 'extractPatterns',
		});
		if (hasSelectedPatterns) {
			patternItems.push({
				kind: 'item',
				key: 'pullPattern',
				label: 'Pull pattern',
				value: 'pullPattern',
			});
		}
		if (hasPatternSources && hasTheme) {
			patternItems.push({
				kind: 'item',
				key: 'buildPatterns',
				label: 'Build patterns',
				value: 'buildPatterns',
			});
		}
	}

	const templateItems: SectionedItem<MenuValue>[] = [];
	if (hasNonSpecialPulls && hasTheme) {
		templateItems.push({
			kind: 'item',
			key: 'buildTemplates',
			label: 'Build templates',
			value: 'buildTemplates',
		});
		templateItems.push({
			kind: 'item',
			key: 'refineTemplates',
			label: 'Refine templates',
			value: 'refineTemplates',
		});
		templateItems.push({
			kind: 'item',
			key: 'viewTemplateDiff',
			label: 'View template diff',
			value: 'viewTemplateDiff',
		});
	}

	const contentItems: SectionedItem<MenuValue>[] = [];
	if (hasNonSpecialPulls && hasTheme && hasPostContentPulls) {
		contentItems.push({
			kind: 'item',
			key: 'buildContents',
			label: 'Build contents',
			value: 'buildContents',
		});
		contentItems.push({
			kind: 'item',
			key: 'refineContents',
			label: 'Refine contents',
			value: 'refineContents',
		});
	}

	const e2eItems: SectionedItem<MenuValue>[] = [];
	if (hasNonSpecialPulls && hasTheme) {
		e2eItems.push({
			kind: 'item',
			key: 'e2e',
			label: 'End-to-end build',
			value: 'e2e',
		});
		e2eItems.push({
			kind: 'item',
			key: 'captureScreens',
			label: 'Capture screens',
			value: 'captureScreens',
		});
	}

	pushSection(items, 'Figma', figmaItems);
	pushSection(items, 'Styles', stylesItems);
	pushSection(items, 'Patterns', patternItems);
	pushSection(items, 'Content', contentItems);
	pushSection(items, 'Templates', templateItems);
	pushSection(items, 'End-to-end', e2eItems);
	pushSection(items, 'Quit', [
		{kind: 'item', key: 'quit', label: 'Sail away', value: 'quit'},
	]);

	return items;
}

function pushSection<V>(
	target: SectionedItem<V>[],
	label: string,
	rows: ReadonlyArray<SectionedItem<V>>,
): void {
	if (rows.length === 0) return;
	target.push({kind: 'header', key: `header:${label}`, label});
	for (const row of rows) target.push(row);
}

function renderView(
	view: View,
	activeProject: Loaded | null,
	onDone: (refresh?: boolean) => void,
	setProject: (p: Loaded) => void,
): React.ReactElement | null {
	if (view === 'setup') {
		return (
			<SetupProject
				onDone={() => onDone(false)}
				onProjectReady={loaded => setProject(loaded)}
			/>
		);
	}

	if (!activeProject) return null;

	switch (view) {
		case 'pull':
			return (
				<PullTemplate
					activeProject={activeProject}
					onDone={() => onDone(true)}
				/>
			);
		case 'extractPatterns':
			return (
				<ExtractPatterns
					activeProject={activeProject}
					onDone={() => onDone(true)}
				/>
			);
		case 'pullPattern':
			return (
				<PullPattern
					activeProject={activeProject}
					onDone={() => onDone(true)}
				/>
			);
		case 'buildPatterns':
			return (
				<BuildPatterns
					activeProject={activeProject}
					onDone={() => onDone(false)}
				/>
			);
		case 'verifyScreenshots':
			return (
				<VerifyScreenshots
					activeProject={activeProject}
					onDone={() => onDone(false)}
				/>
			);
		case 'buildTemplates':
			return (
				<BuildTemplates
					activeProject={activeProject}
					onDone={() => onDone(false)}
				/>
			);
		case 'buildContents':
			return (
				<BuildContents
					activeProject={activeProject}
					onDone={() => onDone(false)}
				/>
			);
		case 'refineTemplates':
			return (
				<RefineTemplates
					activeProject={activeProject}
					onDone={() => onDone(false)}
				/>
			);
		case 'refineContents':
			return (
				<RefineContents
					activeProject={activeProject}
					onDone={() => onDone(false)}
				/>
			);
		case 'viewTemplateDiff':
			return (
				<ViewTemplateDiff
					activeProject={activeProject}
					onDone={() => onDone(false)}
				/>
			);
		case 'buildTheme':
			return (
				<BuildThemeJson
					activeProject={activeProject}
					onDone={() => onDone(true)}
				/>
			);
		case 'e2e':
			return <E2E activeProject={activeProject} onDone={() => onDone(true)} />;
		case 'captureScreens':
			return (
				<CaptureScreens
					activeProject={activeProject}
					onDone={() => onDone(false)}
				/>
			);
		default:
			return null;
	}
}
