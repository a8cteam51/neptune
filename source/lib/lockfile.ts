// Per-project lock so two Neptune processes don't race on the same
// neptune-config.json or design/ tree. Lock is a file holding the owner
// PID; if the PID is gone we steal it (stale-lock recovery).
import {readFile, unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const LOCK_FILENAME = '.neptune-lock';

export type ProjectLock = {
	release: () => Promise<void>;
};

export async function acquireProjectLock(
	projectDir: string,
): Promise<ProjectLock> {
	const lockPath = join(projectDir, LOCK_FILENAME);
	const ourPid = process.pid;

	while (true) {
		try {
			await writeFile(lockPath, String(ourPid), {flag: 'wx'});
			break;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
			const owner = await readOwner(lockPath);
			if (owner !== null && isProcessAlive(owner)) {
				throw new Error(
					`Project is locked by PID ${owner} (${lockPath}). ` +
						'Close the other Neptune instance or remove the lock file.',
				);
			}
			try {
				await unlink(lockPath);
			} catch (cleanupErr) {
				if ((cleanupErr as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw cleanupErr;
				}
			}
		}
	}

	return {
		release: async () => {
			try {
				const owner = await readOwner(lockPath);
				if (owner === ourPid) await unlink(lockPath);
			} catch {
				/* best effort */
			}
		},
	};
}

async function readOwner(lockPath: string): Promise<number | null> {
	try {
		const raw = (await readFile(lockPath, 'utf8')).trim();
		const n = Number(raw);
		return Number.isFinite(n) && n > 0 ? n : null;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw err;
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		// EPERM means the PID exists but we lack permission — still "alive".
		return code === 'EPERM';
	}
}
