// Pulls one pattern's assets from Figma into patterns/<Name>/.
//
// Phases:
//   loading  — reading config.patterns + scanning disk for already-pulled
//              folders.
//   message  — terminal info ("no patterns selected", missing config).
//   picking  — single-pick menu of pattern names from config; rows are
//              tagged with "(pulled)" when patterns/<Name>/code.tsx
//              already exists. User selects the relevant frame in Figma
//              before pressing Enter.
//   pulling  — FigmaPull renders; outRoot is the project's patterns/
//              directory so pullFromFigma writes to patterns/<Name>/.
//              onSuccess writes a small meta.json so the folder is
//              self-describing.
//
// pull-pattern intentionally skips the gate / title-card / template-file
// / preview-path / post-content machinery from pull-template — patterns
// are reusable fragments, not full pages.
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {access} from 'node:fs/promises';
import {join} from 'node:path';
import {writeFileAtomic} from '../lib/atomic-write.js';
import {realClock} from '../lib/clock.js';
import FigmaPull from '../integrations/figma/pull.js';
import {
	getSelectionMetadata,
	type SelectionMetadata,
} from '../integrations/figma/mcp.js';
import Menu from '../lib/menu.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type PickableEntry = {
	name: string;
	alreadyPulled: boolean;
};

type Phase =
	| {kind: 'loading'}
	| {
			kind: 'picking';
			entries: PickableEntry[];
			selection: SelectionMetadata | null;
			selectionError: Error | null;
	  }
	| {kind: 'pulling'; name: string; selection: SelectionMetadata | null}
	| {kind: 'message'; title: string; subtitle?: string};

export default function PullPattern({activeProject, onDone}: Props) {
	const [phase, setPhase] = useState<Phase>({kind: 'loading'});
	const [loadKey, setLoadKey] = useState(0);
	const refresh = () => {
		setPhase({kind: 'loading'});
		setLoadKey(k => k + 1);
	};

	useEffect(() => {
		const controller = new AbortController();

		(async () => {
			const names = activeProject.config.patterns ?? [];
			if (names.length === 0) {
				setPhase({
					kind: 'message',
					title: 'No patterns selected.',
					subtitle: 'Run Extract patterns first to choose which patterns to pull.',
				});
				return;
			}

			const [selResult, alreadyPulledFlags] = await Promise.all([
				getSelectionMetadata({signal: controller.signal}),
				Promise.all(
					names.map(n =>
						hasCodeTsx(join(activeProject.dir, 'patterns', n)),
					),
				),
			]);
			if (controller.signal.aborted) return;

			const entries: PickableEntry[] = names.map((name, i) => ({
				name,
				alreadyPulled: alreadyPulledFlags[i] ?? false,
			}));

			setPhase({
				kind: 'picking',
				entries,
				selection: selResult.ok ? selResult.selection : null,
				selectionError: selResult.ok ? null : selResult.error,
			});
		})();

		return () => controller.abort();
	}, [activeProject.dir, activeProject.config.patterns, loadKey]);

	useInput(
		(input, key) => {
			if (phase.kind === 'message') {
				onDone();
				return;
			}
			if (phase.kind === 'picking') {
				if (key.escape) {
					onDone();
					return;
				}
				if (input === 'r' || input === 'R') {
					refresh();
				}
			}
		},
		{
			isActive: phase.kind === 'message' || phase.kind === 'picking',
		},
	);

	if (phase.kind === 'loading') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Pull pattern</Text>
				<Box marginTop={1}>
					<Text dimColor>Reading patterns and Figma selection…</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'message') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Pull pattern</Text>
				<Box marginTop={1}>
					<Text color="yellow" bold>{phase.title}</Text>
				</Box>
				{phase.subtitle ? <Text dimColor>{phase.subtitle}</Text> : null}
				<Text dimColor>Press any key to return.</Text>
			</Box>
		);
	}

	if (phase.kind === 'picking') {
		const items = phase.entries.map(e => ({
			key: e.name,
			label: e.alreadyPulled ? `${e.name} — (pulled)` : e.name,
			value: e,
		}));
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Pull pattern</Text>
				<SelectionLine
					selection={phase.selection}
					selectionError={phase.selectionError}
				/>
				<Box marginTop={1} flexDirection="column">
					<Text bold>
						Pick a pattern. Select its Figma frame in Figma first.
					</Text>
				</Box>
				<Box marginTop={1}>
					<Menu
						items={items}
						onSelect={item =>
							setPhase({
								kind: 'pulling',
								name: item.value.name,
								selection: phase.selection,
							})
						}
					/>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>Esc to cancel · R to refresh Figma selection.</Text>
				</Box>
			</Box>
		);
	}

	return (
		<FigmaPull
			pageName={phase.name}
			nodeRef=""
			outRoot={join(activeProject.dir, 'patterns')}
			onSuccess={async (_emit, _session, _signal) => {
				const folder = join(activeProject.dir, 'patterns', phase.name);
				const meta = {
					name: phase.name,
					selectionName: phase.selection?.name,
					x: phase.selection?.x,
					y: phase.selection?.y,
					pulledAt: realClock(),
				};
				await writeFileAtomic(
					join(folder, 'meta.json'),
					JSON.stringify(meta, null, 2) + '\n',
				);
			}}
			onDone={onDone}
		/>
	);
}

function SelectionLine({
	selection,
	selectionError,
}: {
	selection: SelectionMetadata | null;
	selectionError: Error | null;
}) {
	if (selectionError) {
		return (
			<Box marginTop={1}>
				<Text color="yellow">
					Could not read Figma selection: {selectionError.message}
				</Text>
			</Box>
		);
	}
	if (!selection) {
		return (
			<Box marginTop={1}>
				<Text dimColor>Figma selection: (none)</Text>
			</Box>
		);
	}
	return (
		<Box marginTop={1}>
			<Text dimColor>
				Figma selection:{' '}
				<Text color="green">{selection.name ?? '(unnamed)'}</Text>
			</Text>
		</Box>
	);
}

async function hasCodeTsx(folder: string): Promise<boolean> {
	try {
		await access(join(folder, 'code.tsx'));
		return true;
	} catch {
		return false;
	}
}
