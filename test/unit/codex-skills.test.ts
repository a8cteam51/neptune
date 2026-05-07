import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import process from 'node:process';
import test from 'ava';
import {extractSkillName} from '../../source/lib/agent-stream.js';

const skillsDirectory = join(
	process.cwd(),
	'plugins',
	'neptune-tools',
	'skills',
);
const codexPluginManifest = join(
	process.cwd(),
	'plugins',
	'neptune-tools',
	'.codex-plugin',
	'plugin.json',
);

test('neptune-tools exposes its skills through a Codex plugin manifest', async t => {
	const manifest = JSON.parse(await readFile(codexPluginManifest, 'utf8')) as {
		name?: unknown;
		skills?: unknown;
	};
	t.is(manifest.name, 'neptune-tools');
	t.is(manifest.skills, './skills/');
});

test('all Neptune skills are addressable by Codex prompt injection', async t => {
	const entries = await readdir(skillsDirectory, {withFileTypes: true});
	const skills = await Promise.all(
		entries
			.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
			.map(async entry => ({
				entry,
				skill: await readFile(
					join(skillsDirectory, entry.name, 'SKILL.md'),
					'utf8',
				),
			})),
	);
	const skillNames: string[] = [];
	for (const {entry, skill} of skills) {
		const frontmatter = /^---\n(?<body>[\s\S]*?)\n---/.exec(skill)?.groups
			?.body;
		t.truthy(frontmatter, `${entry.name} must have YAML frontmatter`);
		const name = /^name:\s*(?<name>[a-z][a-z\d-]*)$/m.exec(frontmatter!)?.groups
			?.name;
		const description = /^description:\s*(?<description>.+)$/m.exec(
			frontmatter!,
		)?.groups?.description;
		t.is(name, entry.name);
		t.true(
			Boolean(description && description.length <= 1024),
			`${entry.name} must have a Codex-readable description`,
		);
		t.is(extractSkillName(`Use the ${entry.name} skill.`), entry.name);
		skillNames.push(entry.name);
	}

	t.deepEqual(skillNames.sort(), [
		'apply-diff',
		'theme-json',
		'tsx-to-blocks',
		'tsx-to-pattern',
		'visual-diff',
	]);
});
