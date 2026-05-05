// Pull-level types. Lives in lib/ so design-walk.ts and the figma
// integrations don't have to reach back into commands/setup-project/.
export type SpecialPullKind = 'devHandoff' | 'styleGuide' | 'templates';

export type TitleCardRef = {
	id: string;
	name: string;
};

export type DevNote = {
	id: string;
	text?: string;
};

export type PullMeta = {
	pageName: string;
	slug: string;
	selectionName?: string;
	x?: number;
	y?: number;
	templateFile?: string;
	themeSlug?: string;
	scaffolded?: boolean;
	special?: SpecialPullKind;
	pulledAt: string;
	devNotes?: DevNote[];
	titleCards?: TitleCardRef[];
	expectedWidth?: number;
	expectedHeight?: number;
};
