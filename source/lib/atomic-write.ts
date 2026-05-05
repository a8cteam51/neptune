// writeFile-then-rename so a SIGINT mid-write can never leave a 0-byte
// or truncated file behind. Same arg shape as fs.promises.writeFile for
// the common buffer/string path.
import {randomBytes} from 'node:crypto';
import {rename, unlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

export async function writeFileAtomic(
	target: string,
	data: string | Uint8Array,
): Promise<void> {
	const dir = dirname(target);
	const tmp = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
	try {
		await writeFile(tmp, data);
		await rename(tmp, target);
	} catch (err) {
		try {
			await unlink(tmp);
		} catch {
			/* best effort */
		}
		throw err;
	}
}
