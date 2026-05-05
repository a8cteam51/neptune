// Top-level menu. Items are gated by what's been done:
//   - "Pull template" needs an active project.
//   - "Verify screenshots" needs at least one non-special pull (i.e. a
//     regular template, not the dev-handoff/style-guide/templates layer).
//   - "Extract patterns" needs at least one non-special pull.
//   - "Build template" needs at least one non-special pull and a themeSlug.
//   - "Build theme.json" needs at least one pull on disk and a themeSlug
//     (it runs the variables merge as a preamble).
import React, {useEffect, useState} from 'react';
import {Box, Text, useApp} from 'ink';
import SelectInput from 'ink-select-input';
import PullTemplate from './commands/pull-template.js';
import ExtractPatterns from './commands/extract-patterns.js';
import VerifyScreenshots from './commands/verify-screenshots.js';
import BuildTemplate from './commands/build-template.js';
import RefineTemplate from './commands/refine-template.js';
import BuildThemeJson from './commands/build-theme-json.js';
import SetupProject, {type Loaded} from './commands/setup-project.js';
import {loadOrInit} from './commands/setup-project/config.js';
import {listPulls} from './lib/design-walk.js';

type Props = {
	name?: string;
};

type MenuValue =
	| 'setup'
	| 'pull'
	| 'extractPatterns'
	| 'verifyScreenshots'
	| 'buildTemplate'
	| 'refineTemplate'
	| 'buildTheme'
	| 'quit';
type MenuItem = {label: string; value: MenuValue};
type View =
	| 'menu'
	| 'setup'
	| 'pull'
	| 'extractPatterns'
	| 'verifyScreenshots'
	| 'buildTemplate'
	| 'refineTemplate'
	| 'buildTheme';

export default function App({name}: Props) {
	const {exit} = useApp();
	const [view, setView] = useState<View>('menu');
	const [activeProject, setActiveProject] = useState<Loaded | null>(null);

	const [hasPulls, setHasPulls] = useState(false);
	const [hasNonSpecialPulls, setHasNonSpecialPulls] = useState(false);
	const hasTheme = Boolean(activeProject?.config.themeSlug);

	useEffect(() => {
		if (!activeProject) {
			setHasPulls(false);
			setHasNonSpecialPulls(false);
			return;
		}
		let cancelled = false;
		listPulls(activeProject.dir)
			.then(pulls => {
				if (cancelled) return;
				setHasPulls(pulls.length > 0);
				setHasNonSpecialPulls(pulls.some(p => p.special === undefined));
			})
			.catch(() => {
				if (!cancelled) {
					setHasPulls(false);
					setHasNonSpecialPulls(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [activeProject]);

	const items: MenuItem[] = [
		...(activeProject
			? []
			: [{label: 'Setup / Load Project', value: 'setup' as const}]),
		...(activeProject
			? [{label: 'Pull template', value: 'pull' as const}]
			: []),
		...(activeProject && hasNonSpecialPulls
			? [
					{
						label: '  ↳ Verify screenshots',
						value: 'verifyScreenshots' as const,
					},
			  ]
			: []),
		...(activeProject && hasNonSpecialPulls
			? [{label: 'Extract patterns', value: 'extractPatterns' as const}]
			: []),
		...(activeProject && hasNonSpecialPulls && hasTheme
			? [{label: 'Build template', value: 'buildTemplate' as const}]
			: []),
		...(activeProject && hasNonSpecialPulls && hasTheme
			? [{label: 'Refine template', value: 'refineTemplate' as const}]
			: []),
		...(activeProject && hasPulls && hasTheme
			? [{label: 'Build theme.json', value: 'buildTheme' as const}]
			: []),
		{label: 'Quit', value: 'quit'},
	];

	const handleSelect = (item: MenuItem) => {
		if (item.value === 'quit') {
			exit();
			return;
		}

		setView(item.value);
	};

	const refreshActiveProject = () => {
		if (!activeProject) return;
		loadOrInit(activeProject.dir)
			.then(refreshed => setActiveProject(refreshed))
			.catch(() => {
				/* keep stale state on error */
			});
	};

	if (view === 'setup') {
		return (
			<SetupProject
				onDone={() => setView('menu')}
				onProjectReady={loaded => setActiveProject(loaded)}
			/>
		);
	}

	if (view === 'pull' && activeProject) {
		return (
			<PullTemplate
				activeProject={activeProject}
				onDone={() => {
					setView('menu');
					refreshActiveProject();
				}}
			/>
		);
	}

	if (view === 'extractPatterns' && activeProject) {
		return (
			<ExtractPatterns
				activeProject={activeProject}
				onDone={() => {
					setView('menu');
					refreshActiveProject();
				}}
			/>
		);
	}

	if (view === 'verifyScreenshots' && activeProject) {
		return (
			<VerifyScreenshots
				activeProject={activeProject}
				onDone={() => setView('menu')}
			/>
		);
	}

	if (view === 'buildTemplate' && activeProject) {
		return (
			<BuildTemplate
				activeProject={activeProject}
				onDone={() => setView('menu')}
			/>
		);
	}

	if (view === 'refineTemplate' && activeProject) {
		return (
			<RefineTemplate
				activeProject={activeProject}
				onDone={() => setView('menu')}
			/>
		);
	}

	if (view === 'buildTheme' && activeProject) {
		return (
			<BuildThemeJson
				activeProject={activeProject}
				onDone={() => {
					setView('menu');
					refreshActiveProject();
				}}
			/>
		);
	}

	return (
		<Box flexDirection="column" padding={1}>
			<Box
				borderStyle="round"
				borderColor="cyan"
				paddingX={2}
				paddingY={1}
				flexDirection="row"
				justifyContent='center'
				alignItems="center"
			>
				<Box flexDirection="column" marginRight={2}>
					<Text color="cyan" bold>{'  ^  ^  ^  '}</Text>
					<Text color="cyan" bold>{'  |  |  |  '}</Text>
					<Text color="cyan" bold>{'  \\  |  /  '}</Text>
					<Text color="cyan" bold>{'   \\_|_/   '}</Text>
					<Text color="cyan" bold>{'     |     '}</Text>
					<Text color="cyan" bold>{'     |    '}</Text>
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
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text bold>What would you like to do?</Text>
				<Box marginTop={1}>
					<SelectInput items={items} onSelect={handleSelect} />
				</Box>
			</Box>
		</Box>
	);
}
