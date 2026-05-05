import test from 'ava';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {
	validateGitRepo,
	validateProjectName,
	validateProjectPath,
	validateThemeSlug,
} from '../../source/lib/validators.js';

test('validateProjectName: rejects empty / whitespace-only', t => {
	t.deepEqual(validateProjectName(''), {
		ok: false,
		error: 'Project name cannot be empty.',
	});
	t.deepEqual(validateProjectName('   '), {
		ok: false,
		error: 'Project name cannot be empty.',
	});
});

test('validateProjectName: rejects leading dash', t => {
	t.deepEqual(validateProjectName(' --foo'), {
		ok: false,
		error: 'Project name cannot start with a dash.',
	});
});

test('validateProjectName: rejects control characters', t => {
	t.false(validateProjectName('foo\x00bar').ok);
	t.false(validateProjectName('foo\nbar').ok);
});

test('validateProjectName: rejects names longer than 100 chars', t => {
	t.false(validateProjectName('a'.repeat(101)).ok);
	t.true(validateProjectName('a'.repeat(100)).ok);
});

test('validateProjectName: trims and accepts normal names', t => {
	t.deepEqual(validateProjectName('  My Project  '), {
		ok: true,
		value: 'My Project',
	});
	t.deepEqual(validateProjectName('café 1'), {
		ok: true,
		value: 'café 1',
	});
});

test('validateThemeSlug: enforces kebab-case', t => {
	t.true(validateThemeSlug('my-theme').ok);
	t.true(validateThemeSlug('a').ok);
	t.true(validateThemeSlug('a1').ok);
	t.false(validateThemeSlug('').ok);
	t.false(validateThemeSlug('My-Theme').ok);
	t.false(validateThemeSlug('-leading').ok);
	t.false(validateThemeSlug('with space').ok);
	t.false(validateThemeSlug('underscore_slug').ok);
});

test('validateGitRepo: accepts HTTPS, SSH, git://', t => {
	t.true(validateGitRepo('https://github.com/org/repo.git').ok);
	t.true(validateGitRepo('http://internal.example/x.git').ok);
	t.true(validateGitRepo('git@github.com:org/repo.git').ok);
	t.true(validateGitRepo('git://example.com/x.git').ok);
	t.true(validateGitRepo('ssh://git@example.com/x.git').ok);
});

test('validateGitRepo: rejects bare paths and shorthand', t => {
	t.false(validateGitRepo('').ok);
	t.false(validateGitRepo('not-a-url').ok);
	t.false(validateGitRepo('gh:org/repo').ok);
	t.false(validateGitRepo('/local/path/to/repo').ok);
});

test('validateProjectPath: rejects empty', t => {
	t.false(validateProjectPath('').ok);
	t.false(validateProjectPath('   ').ok);
});

test('validateProjectPath: refuses /, system dirs, and home itself', t => {
	t.false(validateProjectPath('/').ok);
	t.false(validateProjectPath('/etc').ok);
	t.false(validateProjectPath('/usr/local').ok);
	t.false(validateProjectPath(homedir()).ok);
});

test('validateProjectPath: expands ~ and resolves to absolute', t => {
	const home = homedir();
	const result = validateProjectPath('~/projects/neptune');
	t.true(result.ok);
	if (result.ok) {
		t.is(result.value, resolve(home, 'projects/neptune'));
	}
});

test('validateProjectPath: relative paths resolve against cwd', t => {
	const result = validateProjectPath('./neptune-test-dir');
	t.true(result.ok);
	if (result.ok) {
		t.is(result.value, resolve(process.cwd(), 'neptune-test-dir'));
	}
});
