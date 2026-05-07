// Shared input validators used by setup-project steps and pull-template
// configure-view. Returns a discriminated union so callers don't need to
// double-handle empty/invalid messages.
import {homedir} from 'node:os';
import {resolve} from 'node:path';

export type Validation = {ok: true; value: string} | {ok: false; error: string};

export function validateProjectName(raw: string): Validation {
	const trimmed = raw.trim();
	if (trimmed === '') {
		return {ok: false, error: 'Project name cannot be empty.'};
	}
	if (trimmed.startsWith('-')) {
		return {ok: false, error: 'Project name cannot start with a dash.'};
	}
	if (trimmed.length > 100) {
		return {ok: false, error: 'Project name is too long (max 100 chars).'};
	}
	if (/[\x00-\x1f]/.test(trimmed)) {
		return {ok: false, error: 'Project name contains control characters.'};
	}
	return {ok: true, value: trimmed};
}

export function validateThemeSlug(raw: string): Validation {
	const trimmed = raw.trim();
	if (trimmed === '') {
		return {ok: false, error: 'Theme slug cannot be empty.'};
	}
	if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) {
		return {
			ok: false,
			error: 'Theme slug must be lowercase, alphanumeric or hyphens.',
		};
	}
	return {ok: true, value: trimmed};
}

// Accept HTTPS, SSH (git@host:org/repo.git), and git:// forms. We do not
// expand short forms (gh:org/repo); keep the surface small.
const GIT_URL_RE = /^(?:(?:https?|git|ssh):\/\/[^\s]+|git@[^\s:]+:[^\s]+)$/;

export function validateGitRepo(raw: string): Validation {
	const trimmed = raw.trim();
	if (trimmed === '') {
		return {ok: false, error: 'Git repo URL cannot be empty.'};
	}
	if (!GIT_URL_RE.test(trimmed)) {
		return {
			ok: false,
			error:
				'Git URL must be HTTPS (https://...) or SSH (git@host:org/repo.git).',
		};
	}
	return {ok: true, value: trimmed};
}

const RESERVED_PATHS = new Set([
	'/',
	'/etc',
	'/usr',
	'/usr/local',
	'/var',
	'/private',
	'/System',
	'/Library',
	'/bin',
	'/sbin',
	'/opt',
	'/Volumes',
]);

export function validateProjectPath(raw: string): Validation {
	const trimmed = raw.trim();
	if (trimmed === '') {
		return {ok: false, error: 'Please enter a destination path.'};
	}
	const expanded = trimmed.startsWith('~')
		? trimmed.replace(/^~/, homedir())
		: trimmed;
	const abs = resolve(expanded);
	if (RESERVED_PATHS.has(abs)) {
		return {
			ok: false,
			error: `Refusing to use system path ${abs}.`,
		};
	}
	if (abs === homedir()) {
		return {
			ok: false,
			error: `Refusing to use your home directory directly. Pick a subfolder.`,
		};
	}
	return {ok: true, value: abs};
}
