import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Menu from '../../lib/menu.js';
import TextInput from 'ink-text-input';
import type {SelectionMetadata} from '../../integrations/figma/mcp.js';
import {templateSubdir} from '../../lib/template-scaffold.js';
import {listPulls} from '../../lib/design-walk.js';
import type {PullMeta} from '../../lib/types.js';
import SelectionLine from './selection-line.js';
import {slugify} from './special-meta.js';

type Stage =
	| 'pageName'
	| 'templateFile'
	| 'usesPostContent'
	| 'pageSlug'
	| 'previewPath';

export type ConfigureSubmit = {
	pageName: string;
	slug: string;
	templateFile: string;
	previewPath: string;
	usesPostContent: boolean;
	// Only set when usesPostContent === true.
	pageSlug?: string;
	// Set when another pull already owns the wrapper for this
	// templateFile. The new pull will not rebuild the wrapper.
	contentOnly: boolean;
};

export default function ConfigureView({
	projectDir,
	selection,
	prefilledPageName,
	onSubmit,
	onBack,
}: {
	projectDir: string;
	selection: SelectionMetadata | null;
	prefilledPageName?: string;
	onSubmit: (result: ConfigureSubmit) => void;
	onBack: () => void;
}) {
	// When a title card was picked, prefilledPageName is set and we lock
	// the page-name field, jumping straight to template-file entry.
	// Custom flow (no prefill) seeds page name from the Figma selection
	// and walks both stages.
	const initialPageName = prefilledPageName ?? selection?.name ?? '';
	const initialSlug = prefilledPageName ? slugify(prefilledPageName) : '';
	const isLocked = prefilledPageName !== undefined && initialSlug !== '';
	const initialStage: Stage = isLocked ? 'templateFile' : 'pageName';

	const [stage, setStage] = useState<Stage>(initialStage);
	const [pageName, setPageName] = useState(initialPageName);
	const [slug, setSlug] = useState(initialSlug);
	// State holds the bare stem; ".html" is appended at submit time and
	// in the scaffold-path preview. Keeps the user from having to type
	// (or accidentally omit) the extension.
	const [templateStem, setTemplateStem] = useState('index');
	const [usesPostContent, setUsesPostContent] = useState(false);
	const [pageSlug, setPageSlug] = useState('');
	const [previewPath, setPreviewPath] = useState(
		defaultPreviewPath('index.html'),
	);
	const [error, setError] = useState('');
	// Pre-existing pull (if any) that already owns the chosen
	// templateFile. When set, this pull is forced into content-only
	// mode: the wrapper is the other pull's responsibility.
	const [collidingPull, setCollidingPull] = useState<PullMeta | null>(null);

	useInput((_input, key) => {
		if (key.escape) onBack();
	});

	const submitPageName = (raw: string) => {
		const trimmed = raw.trim();
		if (trimmed === '') {
			setError('Page name cannot be empty.');
			return;
		}
		const s = slugify(trimmed);
		if (s === '') {
			setError('Page name must contain at least one alphanumeric character.');
			return;
		}
		setSlug(s);
		setError('');
		setStage('templateFile');
	};

	const submitTemplateStem = async (raw: string) => {
		const trimmed = raw.trim();
		if (trimmed === '') {
			setError('Template name cannot be empty.');
			return;
		}
		if (/[\\/]/.test(trimmed)) {
			setError('Template name must not contain path separators.');
			return;
		}
		if (trimmed.includes('.')) {
			setError('Type the name only — .html is appended automatically.');
			return;
		}
		setTemplateStem(trimmed);
		const fullFile = `${trimmed}.html`;
		setPreviewPath(defaultPreviewPath(fullFile));
		setError('');

		// Check whether another pull already owns this templateFile so we
		// can force content-only mode and skip re-asking the user about
		// usesPostContent (the answer is forced to true).
		try {
			const pulls = await listPulls(projectDir);
			const other = pulls.find(
				p =>
					p.special === undefined &&
					p.slug !== slug &&
					p.templateFile?.toLowerCase() === fullFile.toLowerCase() &&
					!p.contentOnly,
			);
			setCollidingPull(other ?? null);
			if (other) {
				setUsesPostContent(true);
				setStage('pageSlug');
				return;
			}
		} catch {
			// Best-effort — fall through to the usual prompt.
		}
		setStage('usesPostContent');
	};

	const submitUsesPostContent = (value: boolean) => {
		setUsesPostContent(value);
		setError('');
		if (value) {
			setPageSlug(slug);
			setStage('pageSlug');
		} else {
			setStage('previewPath');
		}
	};

	const submitPageSlug = (raw: string) => {
		const trimmed = raw.trim();
		if (trimmed === '') {
			setError('Page slug cannot be empty.');
			return;
		}
		if (!/^[a-z0-9][a-z0-9_-]*$/.test(trimmed)) {
			setError('Page slug must match ^[a-z0-9][a-z0-9_-]*$.');
			return;
		}
		setPageSlug(trimmed);
		// Page-hosted content lives at /<page-slug> by default. The user
		// can still override at the previewPath stage (e.g. "/" for the
		// static front page).
		setPreviewPath(`/${trimmed}`);
		setError('');
		setStage('previewPath');
	};

	const submitPreviewPath = (raw: string) => {
		const trimmed = raw.trim();
		if (trimmed === '') {
			setError('Preview path cannot be empty.');
			return;
		}
		if (!trimmed.startsWith('/')) {
			setError('Preview path must start with /.');
			return;
		}
		onSubmit({
			pageName: pageName.trim(),
			slug,
			templateFile: `${templateStem}.html`,
			previewPath: trimmed,
			usesPostContent,
			pageSlug: usesPostContent ? pageSlug : undefined,
			contentOnly: collidingPull !== null,
		});
	};

	const hasCoords =
		selection !== null &&
		selection.x !== undefined &&
		selection.y !== undefined;
	const liveSlug = stage === 'pageName' ? slugify(pageName) : slug;

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">
				Pull template
			</Text>

			<Box marginTop={1} flexDirection="column">
				<Text bold>Current Figma selection</Text>
				<Box marginTop={1}>
					<SelectionLine
						selection={selection}
						selectionError={null}
						hasCoords={hasCoords}
					/>
				</Box>
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text bold>
					Page name
					{isLocked ? <Text dimColor> (from title card)</Text> : null}
				</Text>
				<Box marginTop={1}>
					<Text color={stage === 'pageName' ? 'yellow' : 'gray'}>› </Text>
					{stage === 'pageName' ? (
						<TextInput
							value={pageName}
							onChange={setPageName}
							onSubmit={submitPageName}
							placeholder="home"
						/>
					) : (
						<Text dimColor>{pageName}</Text>
					)}
				</Box>
				<Text dimColor>
					Output: design/{liveSlug === '' ? '<slug>' : liveSlug}
				</Text>
			</Box>

			{stage !== 'pageName' ? (
				<Box marginTop={1} flexDirection="column">
					<Text bold>WordPress template name</Text>
					<Box marginTop={1}>
						<Text color={stage === 'templateFile' ? 'yellow' : 'gray'}>› </Text>
						{stage === 'templateFile' ? (
							<>
								<TextInput
									value={templateStem}
									onChange={setTemplateStem}
									onSubmit={raw => void submitTemplateStem(raw)}
									placeholder="index"
								/>
								<Text dimColor>.html</Text>
							</>
						) : (
							<Text dimColor>{templateStem}.html</Text>
						)}
					</Box>
					<Text dimColor>
						Scaffolded into: wp-content/themes/&lt;theme&gt;/
						{templateSubdir(`${templateStem}.html`)}/{templateStem}.html
					</Text>
					<Text dimColor>
						header / footer → parts/, everything else → templates/.
					</Text>
				</Box>
			) : null}

			{stage === 'usesPostContent' ? (
				<Box marginTop={1} flexDirection="column">
					<Text bold>Does this template render via wp:post-content?</Text>
					<Text dimColor>
						Pick &quot;Yes&quot; if the design has a region marked with
						data-neptune-annotations=&quot;post-content&quot;. The wrapper will
						be built around a wp:post-content placeholder, and the marked
						subtree will be built into a page post via build-content.
					</Text>
					<Box marginTop={1}>
						<Menu
							items={[
								{
									key: 'no',
									label: 'No — full template (current behavior)',
									value: 'no',
								},
								{
									key: 'yes',
									label: 'Yes — wrapper + page post-content',
									value: 'yes',
								},
							]}
							onSelect={item => submitUsesPostContent(item.value === 'yes')}
						/>
					</Box>
				</Box>
			) : null}

			{(stage === 'pageSlug' || stage === 'previewPath') && usesPostContent ? (
				<Box marginTop={1} flexDirection="column">
					{collidingPull ? (
						<Text color="yellow">
							{`${templateStem}.html is already defined by pull "${collidingPull.slug}". This pull will only contribute page content; the wrapper won't be rebuilt.`}
						</Text>
					) : null}
					<Text bold>Page slug (the wp_post that hosts this content)</Text>
					<Box marginTop={1}>
						<Text color={stage === 'pageSlug' ? 'yellow' : 'gray'}>› </Text>
						{stage === 'pageSlug' ? (
							<TextInput
								value={pageSlug}
								onChange={setPageSlug}
								onSubmit={submitPageSlug}
								placeholder={slug}
							/>
						) : (
							<Text dimColor>{pageSlug}</Text>
						)}
					</Box>
					<Text dimColor>
						Defaults to the pull slug. Override for the homepage (e.g.
						&quot;home&quot;) or when the WP page slug differs.
					</Text>
				</Box>
			) : null}

			{stage === 'previewPath' ? (
				<Box marginTop={1} flexDirection="column">
					<Text bold>Preview path (relative URL on the running site)</Text>
					<Box marginTop={1}>
						<Text color="yellow">› </Text>
						<TextInput
							value={previewPath}
							onChange={setPreviewPath}
							onSubmit={submitPreviewPath}
							placeholder="/"
						/>
					</Box>
					<Text dimColor>
						Refine captures this URL to compare against the design.
					</Text>
				</Box>
			) : null}

			<Box marginTop={1}>
				<Text dimColor>Enter to advance. Esc to go back.</Text>
			</Box>
			{error === '' ? null : <Text color="red">{error}</Text>}
		</Box>
	);
}

// Sensible default URL for common WordPress template files. The user
// can override during configure; the chosen value is persisted on the
// pull's meta.json so refine doesn't have to re-derive it.
function defaultPreviewPath(templateFile: string): string {
	const stem = templateFile.replace(/\.html$/i, '').toLowerCase();
	if (stem === 'front-page' || stem === 'index' || stem === 'home') return '/';
	if (stem === '404') return '/this-path-should-404';
	if (stem === 'archive') return '/blog';
	if (stem === 'single' || stem === 'single-post') return '/?p=1';
	if (stem === 'page') return '/sample-page';
	return '/';
}
