// Tiny filesystem helpers shared across the build/refine flows. Both
// readers swallow ENOENT and return null so callers can compose
// "load if present, otherwise omit from the agent prompt" without
// boilerplate. Anything other than ENOENT propagates so the caller
// still sees real I/O errors.
import {access, readFile} from 'node:fs/promises';

export async function readIfExists(p: string): Promise<string | null> {
	try {
		await access(p);
		return await readFile(p, 'utf8');
	} catch {
		return null;
	}
}

export async function readBufferIfExists(p: string): Promise<Buffer | null> {
	try {
		await access(p);
		return await readFile(p);
	} catch {
		return null;
	}
}
