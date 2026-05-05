import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import type {SelectionMetadata} from '../../integrations/figma/mcp.js';
import {templateSubdir} from '../../lib/template-scaffold.js';
import SelectionLine from './selection-line.js';
import {slugify} from './special-meta.js';

export default function ConfigureView({
	selection,
	prefilledPageName,
	onSubmit,
	onBack,
}: {
	selection: SelectionMetadata | null;
	prefilledPageName?: string;
	onSubmit: (pageName: string, slug: string, templateFile: string) => void;
	onBack: () => void;
}) {
	// When a title card was picked, prefilledPageName is set and we lock
	// the page-name field, jumping straight to template-file entry.
	// Custom flow (no prefill) seeds page name from the Figma selection
	// and walks both stages.
	const initialPageName = prefilledPageName ?? selection?.name ?? '';
	const initialSlug = prefilledPageName ? slugify(prefilledPageName) : '';
	const isLocked =
		prefilledPageName !== undefined && initialSlug !== '';
	const initialStage: 'pageName' | 'templateFile' = isLocked
		? 'templateFile'
		: 'pageName';

	const [stage, setStage] = useState<'pageName' | 'templateFile'>(
		initialStage,
	);
	const [pageName, setPageName] = useState(initialPageName);
	const [slug, setSlug] = useState(initialSlug);
	const [templateFile, setTemplateFile] = useState('index.html');
	const [error, setError] = useState('');

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

	const submitTemplateFile = (raw: string) => {
		const trimmed = raw.trim();
		if (trimmed === '') {
			setError('Template file cannot be empty.');
			return;
		}
		if (/[\\/]/.test(trimmed)) {
			setError('Template file must not contain path separators.');
			return;
		}
		if (!trimmed.toLowerCase().endsWith('.html')) {
			setError('Template file must be a .html file.');
			return;
		}
		onSubmit(pageName.trim(), slug, trimmed);
	};

	const hasCoords =
		selection !== null &&
		selection.x !== undefined &&
		selection.y !== undefined;
	const liveSlug = stage === 'pageName' ? slugify(pageName) : slug;

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">Pull template</Text>

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

			{stage === 'templateFile' ? (
				<Box marginTop={1} flexDirection="column">
					<Text bold>WordPress template file</Text>
					<Box marginTop={1}>
						<Text color="yellow">› </Text>
						<TextInput
							value={templateFile}
							onChange={setTemplateFile}
							onSubmit={submitTemplateFile}
							placeholder="index.html"
						/>
					</Box>
					<Text dimColor>
						Scaffolded into: wp-content/themes/&lt;theme&gt;/
						{templateFile.toLowerCase().endsWith('.html')
							? `${templateSubdir(templateFile)}/`
							: ''}
						{templateFile}
					</Text>
					<Text dimColor>
						header.html / footer.html → parts/, everything else → templates/.
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
