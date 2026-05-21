// Query-loop seeding. When a build or refine writes block markup that
// contains one or more `wp:query` blocks, the live page will only show
// as many cards as there are matching posts. A fresh WordPress install
// ships with exactly one post (the seed "Hello World" at id 1), so a
// design that expects a 3×2 grid renders as a single card on capture
// and the refine diff agent sees a huge visual delta that has nothing
// to do with the template.
//
// The fix: parse the just-written markup, find the largest `perPage`
// among any `query.postType === "post"` query loops, and clone post 1
// via wp-cli (`wp post create --from-post=1 --post-status=publish`)
// until the total published post count meets that number. Clones share
// the seed's content — that's fine, the goal is a representative card
// count for the visual diff, not realistic content.
//
// CPT query loops (postType !== "post") are skipped with a warning;
// seeding them would require an existing CPT post and knowledge of
// the project's data model.
import {wpCli} from './wp-cli.js';
import type {StudioSession} from '../integrations/studio/mcp.js';
import type {LogEvent} from './event-list.js';

export type QueryLoopRequirement = {
	perPage: number;
	postType: string;
};

// Scans block markup for `<!-- wp:query {…} -->` openers, parses each
// attribute JSON, and returns the perPage + postType pair for every
// one that declares both. Malformed JSON, missing perPage, or comments
// without attributes are silently skipped — they don't represent a
// concrete seeding requirement.
export function parseQueryLoopRequirements(
	markup: string,
): QueryLoopRequirement[] {
	const results: QueryLoopRequirement[] = [];
	const prefix = '<!-- wp:query ';
	let cursor = 0;
	while (true) {
		const open = markup.indexOf(prefix, cursor);
		if (open === -1) break;
		const attrStart = open + prefix.length;
		const attrEnd = findAttrEnd(markup, attrStart);
		if (attrEnd === -1) {
			cursor = attrStart;
			continue;
		}
		const attrText = markup.slice(attrStart, attrEnd + 1);
		cursor = attrEnd + 1;
		let parsed: unknown;
		try {
			parsed = JSON.parse(attrText);
		} catch {
			continue;
		}
		if (typeof parsed !== 'object' || parsed === null) continue;
		const query = (parsed as {query?: unknown}).query;
		if (typeof query !== 'object' || query === null) continue;
		const perPage = (query as {perPage?: unknown}).perPage;
		if (
			typeof perPage !== 'number' ||
			!Number.isInteger(perPage) ||
			perPage <= 0
		)
			continue;
		const postType = (query as {postType?: unknown}).postType;
		results.push({
			perPage,
			postType: typeof postType === 'string' ? postType : 'post',
		});
	}
	return results;
}

// Walk a JSON object literal starting at index `start`, where the
// character at `start` is the opening `{`. Returns the index of the
// matching closing `}`, or -1 if no balanced match is found. String
// contents (including escape sequences) are ignored for brace counting.
function findAttrEnd(markup: string, start: number): number {
	if (markup[start] !== '{') return -1;
	let depth = 0;
	let inString = false;
	let escape = false;
	for (let i = start; i < markup.length; i++) {
		const c = markup[i];
		if (escape) {
			escape = false;
			continue;
		}
		if (inString) {
			if (c === '\\') escape = true;
			else if (c === '"') inString = false;
			continue;
		}
		if (c === '"') {
			inString = true;
			continue;
		}
		if (c === '{') {
			depth++;
		} else if (c === '}') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

// Returns the number of published wp_posts of the given post_type.
async function countPublishedPosts(
	session: StudioSession,
	nameOrPath: string,
	postType: string,
): Promise<number> {
	const out = await wpCli(
		session,
		nameOrPath,
		`post list --post_type=${postType} --post_status=publish --format=count`,
	);
	// wp-cli's --format=count emits the integer on its own line, often
	// with surrounding whitespace and (rarely) deprecation banners. Pull
	// the last integer in the output.
	const match = /(\d+)\s*$/.exec(out.trim());
	if (!match) {
		throw new Error(
			`wp post list --format=count produced unparseable output: ${out
				.slice(0, 200)
				.trim()}`,
		);
	}
	return Number.parseInt(match[1]!, 10);
}

// Clones post 1 via `wp post create --from-post=1` and publishes it.
// `--porcelain` makes wp-cli emit just the new post id; we don't need
// it for anything downstream but we parse it for the progress message.
async function cloneSeedPost(
	session: StudioSession,
	nameOrPath: string,
): Promise<number> {
	const out = await wpCli(
		session,
		nameOrPath,
		'post create --from-post=1 --post-status=publish --porcelain',
	);
	const match = /(\d+)\s*$/.exec(out.trim());
	if (!match) {
		throw new Error(
			`wp post create --porcelain produced unparseable output: ${out
				.slice(0, 200)
				.trim()}`,
		);
	}
	return Number.parseInt(match[1]!, 10);
}

// Ensures the live site has enough published posts to render every
// query-loop block in `markup`. Idempotent: counts first, only clones
// the shortfall. No-op when the markup contains no `post`-typed query
// loops.
export async function ensureQueryLoopPosts(
	session: StudioSession,
	nameOrPath: string,
	markup: string,
	onEvent: (ev: LogEvent) => void,
): Promise<void> {
	const requirements = parseQueryLoopRequirements(markup);
	if (requirements.length === 0) return;

	const cptRequirements = requirements.filter(r => r.postType !== 'post');
	for (const cpt of cptRequirements) {
		onEvent({
			kind: 'warn',
			message: `Query loop targets postType="${cpt.postType}" (perPage=${cpt.perPage}); skipping seed (CPT seeding not supported).`,
		});
	}

	const postRequirements = requirements.filter(r => r.postType === 'post');
	if (postRequirements.length === 0) return;

	const required = Math.max(...postRequirements.map(r => r.perPage));
	const current = await countPublishedPosts(session, nameOrPath, 'post');
	if (current >= required) {
		onEvent({
			kind: 'step',
			message: `Query loop expects ${required} posts; ${current} already published. No cloning needed.`,
		});
		return;
	}

	const shortfall = required - current;
	onEvent({
		kind: 'step',
		message: `Query loop expects ${required} posts; ${current} published. Cloning post 1 ${shortfall} time${shortfall === 1 ? '' : 's'}.`,
	});

	for (let i = 0; i < shortfall; i++) {
		const newId = await cloneSeedPost(session, nameOrPath);
		onEvent({
			kind: 'step',
			message: `Cloned post 1 → id ${newId} (${current + i + 1}/${required})`,
		});
	}

	onEvent({
		kind: 'success',
		message: `Query loop seeding complete (${required} published posts).`,
	});
}
