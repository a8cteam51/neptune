// Pull-template state machine.
//
// Phases:
//   loading      — fetching selection + disk pull state in parallel.
//   gate         — one or both of styleGuide/templates not yet pulled.
//                  User picks which special to pull next.
//   picking      — gate satisfied. User picks a title card (from the
//                  templates pull) or "Custom" to enter free-form mode.
//   configuring  — pageName + WordPress template file entry. PageName is
//                  locked when arrived from a title-card pick.
//   pulling      — FigmaPull renders; onSuccess does asset download,
//                  scaffolding, special-pull extraction, then writes
//                  meta.json. Errors surface in FigmaPull's error UI.
//   message      — terminal error (couldn't load pull status). User
//                  presses any key to return to the menu.
//
// Refresh: incrementing loadKey re-runs the loading effect to re-poll
// the Figma selection without leaving the tool.
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
	findPullBySlug,
	findSpecialPull,
	getSpecialPullsStatus,
	writePullMeta,
} from '../../lib/design-walk.js';
import {downloadCodeAssets} from '../../integrations/figma/assets-fetch.js';
import {parseTitleCards} from '../../integrations/figma/handoff-parse.js';
import {
	getSelectionMetadata,
	type SelectionMetadata,
} from '../../integrations/figma/mcp.js';
import FigmaPull from '../../integrations/figma/pull.js';
import {realClock} from '../../lib/clock.js';
import {openStudioSession} from '../../integrations/studio/mcp.js';
import {ensureTemplate, templateTargetFor} from '../../lib/wp-templates.js';
import {ensurePage, pageTargetFor} from '../../lib/wp-pages.js';
import {resolve} from 'node:path';
import type {
	SpecialPullKind,
	TitleCardRef,
} from '../../lib/types.js';
import type {Loaded} from '../setup-project/types.js';
import ConfigureView from './configure-view.js';
import type {ConfigureSubmit} from './configure-view.js';
import GateView from './gate-view.js';
import PickerView from './picker-view.js';
import {SPECIAL_META} from './special-meta.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type Phase =
	| {kind: 'loading'}
	| {kind: 'message'; title: string; subtitle?: string}
	| {
			kind: 'gate';
			selection: SelectionMetadata | null;
			selectionError: Error | null;
			hasStyleGuide: boolean;
			hasTemplates: boolean;
	  }
	| {
			kind: 'picking';
			selection: SelectionMetadata | null;
			selectionError: Error | null;
			titleCards: TitleCardRef[];
	  }
	| {
			kind: 'configuring';
			selection: SelectionMetadata | null;
			selectionError: Error | null;
			titleCards: TitleCardRef[];
			prefilledPageName?: string;
	  }
	| {
			kind: 'pulling';
			pageName: string;
			slug: string;
			templateFile?: string;
			previewPath?: string;
			special?: SpecialPullKind;
			selection: SelectionMetadata | null;
			usesPostContent?: boolean;
			pageSlug?: string;
			contentOnly?: boolean;
	  };

export default function PullTemplate({activeProject, onDone}: Props) {
	const [phase, setPhase] = useState<Phase>({kind: 'loading'});
	const [loadKey, setLoadKey] = useState(0);
	const refresh = () => {
		setPhase({kind: 'loading'});
		setLoadKey(k => k + 1);
	};

	useEffect(() => {
		const controller = new AbortController();

		(async () => {
			try {
				const [selResult, status, templatesPull] = await Promise.all([
					getSelectionMetadata({signal: controller.signal}),
					getSpecialPullsStatus(activeProject.dir),
					findSpecialPull(activeProject.dir, 'templates'),
				]);
				if (controller.signal.aborted) return;
				const sel = selResult.ok ? selResult.selection : null;
				const selectionError = selResult.ok ? null : selResult.error;
				const gateOpen = status.hasStyleGuide && status.hasTemplates;
				if (gateOpen) {
					setPhase({
						kind: 'picking',
						selection: sel,
						selectionError,
						titleCards: templatesPull?.titleCards ?? [],
					});
				} else {
					setPhase({
						kind: 'gate',
						selection: sel,
						selectionError,
						hasStyleGuide: status.hasStyleGuide,
						hasTemplates: status.hasTemplates,
					});
				}
			} catch (err) {
				if (controller.signal.aborted) return;
				setPhase({
					kind: 'message',
					title: 'Could not load pull status.',
					subtitle: err instanceof Error ? err.message : String(err),
				});
			}
		})();

		return () => {
			controller.abort();
		};
	}, [activeProject.dir, loadKey]);

	useInput(
		() => {
			onDone();
		},
		{isActive: phase.kind === 'message'},
	);

	const beginPull = async (
		next: Extract<Phase, {kind: 'pulling'}>,
	): Promise<void> => {
		// Block re-pulls that would clobber an existing pull tagged with a
		// different `special` kind. Allow re-pulling the same kind.
		const existing = await findPullBySlug(activeProject.dir, next.slug);
		if (existing && existing.special !== next.special) {
			setPhase({
				kind: 'message',
				title: `Slug "${next.slug}" already exists with different metadata.`,
				subtitle:
					`Existing pull is special=${
						existing.special ?? 'none'
					}, requested special=${next.special ?? 'none'}. ` +
					'Pick a different page name, or remove the existing design folder.',
			});
			return;
		}
		setPhase(next);
	};

	if (phase.kind === 'loading') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Pull template</Text>
				<Box marginTop={1}>
					<Text color="cyan">
						<Spinner type="dots" />
					</Text>
					<Text>{' Reading current Figma selection…'}</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'message') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Pull template</Text>
				<Box marginTop={1}>
					<Text color="red" bold>{phase.title}</Text>
				</Box>
				{phase.subtitle ? <Text dimColor>{phase.subtitle}</Text> : null}
				<Text dimColor>Press any key to return to the menu.</Text>
			</Box>
		);
	}

	if (phase.kind === 'gate') {
		return (
			<GateView
				selection={phase.selection}
				selectionError={phase.selectionError}
				hasStyleGuide={phase.hasStyleGuide}
				hasTemplates={phase.hasTemplates}
				onSelect={kind => {
					const meta = SPECIAL_META[kind];
					void beginPull({
						kind: 'pulling',
						pageName: meta.pageName,
						slug: meta.slug,
						special: kind,
						selection: phase.selection,
					});
				}}
				onCancel={onDone}
				onRefresh={refresh}
			/>
		);
	}

	if (phase.kind === 'picking') {
		return (
			<PickerView
				selection={phase.selection}
				selectionError={phase.selectionError}
				titleCards={phase.titleCards}
				onSelectTitleCard={card =>
					setPhase({
						kind: 'configuring',
						selection: phase.selection,
						selectionError: phase.selectionError,
						titleCards: phase.titleCards,
						prefilledPageName: card.name,
					})
				}
				onSelectCustom={() =>
					setPhase({
						kind: 'configuring',
						selection: phase.selection,
						selectionError: phase.selectionError,
						titleCards: phase.titleCards,
					})
				}
				onCancel={onDone}
				onRefresh={refresh}
			/>
		);
	}

	if (phase.kind === 'configuring') {
		return (
			<ConfigureView
				projectDir={activeProject.dir}
				selection={phase.selection}
				prefilledPageName={phase.prefilledPageName}
				onSubmit={(submit: ConfigureSubmit) =>
					void beginPull({
						kind: 'pulling',
						pageName: submit.pageName,
						slug: submit.slug,
						templateFile: submit.templateFile,
						previewPath: submit.previewPath,
						usesPostContent: submit.usesPostContent,
						pageSlug: submit.pageSlug,
						contentOnly: submit.contentOnly,
						selection: phase.selection,
					})
				}
				onBack={() =>
					setPhase({
						kind: 'picking',
						selection: phase.selection,
						selectionError: phase.selectionError,
						titleCards: phase.titleCards,
					})
				}
			/>
		);
	}

	const themeSlug = activeProject.config.themeSlug;
	const isSpecial = phase.special !== undefined;

	return (
		<FigmaPull
			pageName={phase.slug}
			nodeRef=""
			outRoot={join(activeProject.dir, 'design')}
			onSuccess={async (emit, _session, signal) => {
				const pullDir = join(activeProject.dir, 'design', phase.slug);

				// Asset download is part of the pull's correctness contract;
				// failure here means the pull is incomplete, so escalate.
				await downloadCodeAssets(pullDir, emit, signal);

				// Validate code.tsx against the user's usesPostContent flag
				// so we fail loud instead of letting the agent build with
				// no seam (or building a wrapper that ignores annotations).
				let pageId: number | undefined;
				if (!isSpecial) {
					const codePath = join(pullDir, 'code.tsx');
					const code = await readFile(codePath, 'utf8');
					const hasAnnotation = /data-neptune-annotations="post-content"/.test(
						code,
					);
					if (phase.usesPostContent && !hasAnnotation) {
						throw new Error(
							'Pull is flagged as uses post_content but code.tsx contains no data-neptune-annotations="post-content". Add the annotation in Figma or unflag the pull.',
						);
					}
					if (!phase.usesPostContent && hasAnnotation) {
						emit({
							kind: 'warn',
							message:
								'code.tsx has data-neptune-annotations="post-content" but this pull is not flagged as uses post_content. The annotation will be ignored.',
						});
					}
				}

				let scaffolded = false;
				if (!isSpecial) {
					if (!themeSlug) {
						throw new Error(
							'themeSlug missing from config; template not scaffolded.',
						);
					}
					if (!phase.templateFile) {
						throw new Error('templateFile missing for non-special pull.');
					}
					const wpRoot = resolve(activeProject.dir, 'wordpress');
					const studio = await openStudioSession({signal});
					try {
						// Skip wrapper scaffold for content-only pulls — the
						// pull that owns the templateFile already scaffolded it.
						if (!phase.contentOnly) {
							const target = templateTargetFor(
								phase.templateFile,
								phase.pageName,
							);
							const result = await ensureTemplate(studio, wpRoot, target);
							scaffolded = result.created;
						}
						if (phase.usesPostContent && phase.pageSlug) {
							const pageTarget = pageTargetFor(
								phase.pageSlug,
								phase.pageName,
							);
							const ensured = await ensurePage(studio, wpRoot, pageTarget);
							pageId = ensured.id;
							emit({
								kind: 'step',
								message: `Page ${ensured.created ? 'created' : 'found'}: page:${pageTarget.slug} (id ${ensured.id})`,
							});
						}
					} finally {
						studio.close();
					}
				}

				let titleCards: TitleCardRef[] | undefined;
				if (phase.special === 'templates') {
					emit({kind: 'step', message: 'Parsing templates metadata…'});
					const xmlPath = join(
						activeProject.dir,
						'design',
						phase.slug,
						'metadata.xml',
					);
					const xml = await readFile(xmlPath, 'utf8');
					titleCards = parseTitleCards(xml);
					emit({
						kind: 'step',
						message: `Found ${titleCards.length} title card${
							titleCards.length === 1 ? '' : 's'
						}`,
					});
				}

				// Write meta only after every other piece succeeded so a
				// partial pull doesn't leave a meta.json claiming success.
				await writePullMeta(activeProject.dir, phase.slug, {
					pageName: phase.pageName,
					slug: phase.slug,
					selectionName: phase.selection?.name,
					x: phase.selection?.x,
					y: phase.selection?.y,
					templateFile: phase.templateFile,
					previewPath: phase.previewPath,
					themeSlug,
					scaffolded,
					special: phase.special,
					pulledAt: realClock(),
					titleCards,
					usesPostContent: phase.usesPostContent || undefined,
					pageSlug: phase.usesPostContent ? phase.pageSlug : undefined,
					pageId,
					contentOnly: phase.contentOnly || undefined,
				});
			}}
			onDone={onDone}
		/>
	);
}
