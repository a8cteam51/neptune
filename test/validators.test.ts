import test from 'ava';
import {
	validateGitRepo,
	validateProjectName,
	validateThemeSlug,
} from '../source/lib/validators.js';

test('validateProjectName rejects leading dash', t => {
	t.deepEqual(validateProjectName(' --foo'), {
		ok: false,
		error: 'Project name cannot start with a dash.',
	});
});

test('validateProjectName trims and accepts normal names', t => {
	t.deepEqual(validateProjectName('  My Project  '), {
		ok: true,
		value: 'My Project',
	});
});

test('validateThemeSlug enforces kebab-case', t => {
	t.true(validateThemeSlug('my-theme').ok);
	t.false(validateThemeSlug('My-Theme').ok);
	t.false(validateThemeSlug('-leading').ok);
	t.false(validateThemeSlug('with space').ok);
});

test('validateGitRepo accepts HTTPS and SSH', t => {
	t.true(validateGitRepo('https://github.com/org/repo.git').ok);
	t.true(validateGitRepo('git@github.com:org/repo.git').ok);
	t.false(validateGitRepo('not-a-url').ok);
	t.false(validateGitRepo('').ok);
});
