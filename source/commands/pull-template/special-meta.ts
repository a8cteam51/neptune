// Specials are fixed-purpose pulls that gate access to the rest of the
// flow. Pulling all three (Dev Handoff, Style Guide, Templates) opens
// the picker and free-form pulls.
import type {SpecialPullKind} from '../../lib/types.js';

export const SPECIAL_META: Record<
	SpecialPullKind,
	{pageName: string; slug: string; label: string}
> = {
	devHandoff: {
		pageName: 'Dev Handoff',
		slug: 'dev-handoff',
		label: 'Dev Handoff template',
	},
	styleGuide: {
		pageName: 'Style Guide',
		slug: 'style-guide',
		label: 'Style Guide template',
	},
	templates: {
		pageName: 'Templates',
		slug: 'templates',
		label: 'Templates layer',
	},
};

export function slugify(input: string): string {
	return input
		.normalize('NFKD')
		.replaceAll(/\p{M}/gu, '')
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-+|-+$/g, '');
}
