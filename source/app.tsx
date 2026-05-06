// Top-level menu. Items are gated by what's been done:
//   - "Pull template" needs an active project.
//   - "Verify screenshots" needs at least one non-special pull.
//   - "Extract patterns" needs at least one non-special pull.
//   - "Build template" needs at least one non-special pull and a themeSlug.
//   - "Build theme.json" needs at least one pull on disk and a themeSlug
//     (it runs the variables merge as a preamble).
import React, {useEffect, useState} from 'react';
import {Box, Text, useApp} from 'ink';
import SectionedMenu, {
	type SectionedItem,
} from './lib/sectioned-menu.js';
import PullTemplate from './commands/pull-template.js';
import ExtractPatterns from './commands/extract-patterns.js';
import VerifyScreenshots from './commands/verify-screenshots.js';
import BuildTemplates from './commands/build-templates.js';
import BuildContent from './commands/build-content.js';
import BuildPatterns from './commands/build-patterns.js';
import RefineTemplates from './commands/refine-templates.js';
import ViewTemplateDiff from './commands/view-template-diff.js';
import BuildThemeJson from './commands/build-theme-json.js';
import SetupProject, {type Loaded} from './commands/setup-project.js';
import {loadOrInit} from './commands/setup-project/config.js';
import {listPulls} from './lib/design-walk.js';
import {listPatternSources} from './lib/patterns.js';
import {acquireProjectLock, type ProjectLock} from './lib/lockfile.js';
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
	| 'buildPatterns'
	| 'verifyScreenshots'
	| 'buildTemplates'
	| 'buildContent'
	| 'refineTemplates'
	| 'viewTemplateDiff'
	| 'buildTheme';

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
	const [siteStatus, setSiteStatus] = useState<
		'pending' | SiteStatus | null
	>(null);
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

	useEffect(() => {
		if (!activeProject) return;
		let lock: ProjectLock | null = null;
		let released = false;

		acquireProjectLock(activeProject.dir)
			.then(acquired => {
				if (released) {
					void acquired.release();
					return;
				}
				lock = acquired;
			})
			.catch(err => {
				setAutoLoadError(err instanceof Error ? err.message : String(err));
			});

		return () => {
			released = true;
			if (lock) void lock.release();
		};
	}, [activeProject]);

	const items = buildMenuItems({
		hasActive: Boolean(activeProject),
		hasPulls,
		hasNonSpecialPulls,
		hasPostContentPulls,
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
				justifyContent="center"
				alignItems="center"
			>
				<Box flexDirection="column" marginRight={2}>
					<Text color="cyan" bold>{'  ^  ^  ^ '}</Text>
					<Text color="cyan" bold>{'  |  |  | '}</Text>
					<Text color="cyan" bold>{'   \\_|_/   '}</Text>
					<Text color="cyan" bold>{'     |     '}</Text>
					<Text color="cyan" bold>{'     |    '}</Text>
					<Text color="cyan" bold>{'     |    '}</Text>
				</Box>
				<Box flexDirection="column">
					<Text color="cyan" bold>{'    _   __           __                  '}</Text>
					<Text color="cyan" bold>{'   / | / /__  ____  / /___  ______  ___  '}</Text>
					<Text color="cyan" bold>{'  /  |/ / _ \\/ __ \\/ __/ / / / __ \\/ _ \\ '}</Text>
					<Text color="cyan" bold>{' / /|  /  __/ /_/ / /_/ /_/ / / / /  __/ '}</Text>
					<Text color="cyan" bold>{'/_/ |_/\\___/ .___/\\__/\\__,_/_/ /_/\\___/  '}</Text>
					<Text color="cyan" bold>{'          /_/                            '}</Text>
				</Box>
			</Box>

			<Box marginTop={1} flexDirection="column" alignItems="center">
				<Text>
					Welcome to <Text color="cyan" bold>Neptune</Text>
					{name ? <>, <Text color="green" bold>{name}</Text></> : ''}.
				</Text>
				{activeProject ? (
					<Text>
						Active project:{' '}
						<Text color="green" bold>
							{activeProject.config.projectName ?? activeProject.dir}
						</Text>
					</Text>
				) : (
					<Text dimColor>
						No active project — run Setup / Load Project.
					</Text>
				)}
				{activeProject ? <SiteStatusLine status={siteStatus} /> : null}
				{autoLoadError ? (
					<Text color="yellow">{autoLoadError}</Text>
				) : null}
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text bold>What would you like to do?</Text>
				<Box marginTop={1}>
					<SectionedMenu
						items={items}
						onSelect={handleSelect}
					/>
				</Box>
			</Box>
		</Box>
	);
}

function SiteStatusLine({
	status,
}: {
	status: 'pending' | SiteStatus | null;
}) {
	if (status === null || status === 'pending') {
		return <Text dimColor>Studio site: checking…</Text>;
	}
	if (status.state === 'running') {
		return (
			<Text>
				Studio site:{' '}
				<Text color="green" bold>● running</Text>{' '}
				<Text dimColor>({status.url})</Text>
			</Text>
		);
	}
	if (status.state === 'stopped') {
		return (
			<Text>
				Studio site:{' '}
				<Text color="yellow" bold>● stopped</Text>{' '}
				<Text dimColor>
					({status.url}). Start it in Studio to use Pull / Build / Refine.
				</Text>
			</Text>
		);
	}
	return (
		<Text>
			Studio site:{' '}
			<Text color="yellow" bold>● unknown</Text>{' '}
			<Text dimColor>{status.reason}</Text>
		</Text>
	);
}

// Menu items are partitioned into top-level sections (Figma / Styles /
// Patterns / Templates / Content). The section header itself is
// non-selectable; arrow keys jump straight from one selectable row to
// the next. Sections that have no available actions for the current
// project state are omitted entirely so the cursor never lands on an
// empty group.
function buildMenuItems({
	hasActive,
	hasPulls,
	hasNonSpecialPulls,
	hasPostContentPulls,
	hasPatternSources,
	hasTheme,
}: {
	hasActive: boolean;
	hasPulls: boolean;
	hasNonSpecialPulls: boolean;
	hasPostContentPulls: boolean;
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
			key: 'buildContent',
			label: 'Build content',
			value: 'buildContent',
		});
	}

	pushSection(items, 'Figma', figmaItems);
	pushSection(items, 'Styles', stylesItems);
	pushSection(items, 'Patterns', patternItems);
	pushSection(items, 'Templates', templateItems);
	pushSection(items, 'Content', contentItems);
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
		case 'buildContent':
			return (
				<BuildContent
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
		default:
			return null;
	}
}
