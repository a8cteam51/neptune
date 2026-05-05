// Walks design/<slug>/variables.json across all pulls and merges them
// into a single variables/all-variables.json. First-write-wins on key
// conflicts; later pulls' clashing values are dropped with a warning.
import {mkdir, readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {writeFileAtomic} from './atomic-write.js';
import type {LogEvent} from './event-list.js';

export async function* buildVariables(
	projectDir: string,
): AsyncGenerator<LogEvent> {
	const designDir = join(projectDir, 'design');

	yield {kind: 'step', message: `Scanning ${designDir}`};

	let pageDirs: string[];
	try {
		pageDirs = (await readdir(designDir, {withFileTypes: true}))
			.filter(d => d.isDirectory())
			.map(d => d.name)
			.sort();
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error('No design/ folder yet — pull a template first.');
		}
		throw err;
	}

	if (pageDirs.length === 0) {
		throw new Error('design/ exists but contains no page folders.');
	}

	const merged: Record<string, unknown> = {};
	let pagesProcessed = 0;

	for (const name of pageDirs) {
		const variablesPath = join(designDir, name, 'variables.json');

		let raw: string;
		try {
			raw = await readFile(variablesPath, 'utf8');
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				yield {kind: 'warn', message: `${name}: no variables.json, skipping`};
				continue;
			}
			throw err;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			yield {kind: 'warn', message: `${name}: invalid JSON, skipping`};
			continue;
		}

		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			yield {
				kind: 'warn',
				message: `${name}: variables.json is not a JSON object, skipping`,
			};
			continue;
		}

		const obj = parsed as Record<string, unknown>;
		let added = 0;
		let exactDupes = 0;
		let conflicts = 0;

		for (const [k, v] of Object.entries(obj)) {
			if (!(k in merged)) {
				merged[k] = v;
				added++;
			} else if (deepEqual(merged[k], v)) {
				exactDupes++;
			} else {
				conflicts++;
			}
		}

		yield {
			kind: 'step',
			message: `${name}: +${added}, ${exactDupes} dupes, ${conflicts} conflicts`,
		};

		if (conflicts > 0) {
			yield {
				kind: 'warn',
				message: `${name}: ${conflicts} key(s) clashed with earlier pages — keeping earlier values`,
			};
		}

		pagesProcessed++;
	}

	if (pagesProcessed === 0) {
		throw new Error('No usable variables.json files found in design/.');
	}

	const outDir = join(projectDir, 'variables');
	await mkdir(outDir, {recursive: true});
	const outPath = join(outDir, 'all-variables.json');
	await writeFileAtomic(outPath, JSON.stringify(merged, null, 2) + '\n');

	yield {
		kind: 'step',
		message: `Wrote ${Object.keys(merged).length} unique variables to ${outPath}`,
	};
}

// Order-insensitive structural equality. Avoids JSON.stringify's
// key-order sensitivity, which produced spurious "conflicts" for
// objects merely defined with keys in different order.
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i])) return false;
		}
		return true;
	}
	if (typeof a === 'object') {
		const aKeys = Object.keys(a as object);
		const bKeys = Object.keys(b as object);
		if (aKeys.length !== bKeys.length) return false;
		const bObj = b as Record<string, unknown>;
		const aObj = a as Record<string, unknown>;
		for (const k of aKeys) {
			if (!(k in bObj)) return false;
			if (!deepEqual(aObj[k], bObj[k])) return false;
		}
		return true;
	}
	return false;
}
