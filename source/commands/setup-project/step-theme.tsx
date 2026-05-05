import React from 'react';
import TextStep from '../../lib/text-step.js';
import {validateThemeSlug} from '../../lib/validators.js';
import type {NeptuneConfig} from './types.js';

export default function ThemeStep({
	config,
	onComplete,
}: {
	config: NeptuneConfig;
	onComplete: (updates: Partial<NeptuneConfig>) => void;
}) {
	return (
		<TextStep
			title="Step 3 — Theme slug"
			hint="Lowercase, alphanumeric, hyphens. Must match a theme directory in wp-content/themes/."
			placeholder="my-theme"
			initialValue={config.themeSlug ?? ''}
			validate={validateThemeSlug}
			onSubmit={value =>
				onComplete({
					themeSlug: value,
					steps: {...config.steps, themeConfigured: true},
				})
			}
		/>
	);
}
