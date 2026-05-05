// Tracks long-running child processes so a SIGINT/SIGTERM on Neptune
// kills them instead of orphaning them. Use trackChild around any spawn()
// that runs longer than a few seconds.
import type {ChildProcess} from 'node:child_process';

const live = new Set<ChildProcess>();
let installed = false;

export function trackChild(child: ChildProcess): () => void {
	installShutdownHooks();
	live.add(child);
	const drop = () => {
		live.delete(child);
	};
	child.once('exit', drop);
	child.once('error', drop);
	return drop;
}

function installShutdownHooks() {
	if (installed) return;
	installed = true;
	const shutdown = (signal: NodeJS.Signals | 'beforeExit') => () => {
		for (const child of live) {
			try {
				child.kill(signal === 'beforeExit' ? 'SIGTERM' : signal);
			} catch {
				/* best effort */
			}
		}
	};
	process.once('SIGINT', shutdown('SIGINT'));
	process.once('SIGTERM', shutdown('SIGTERM'));
	process.once('SIGHUP', shutdown('SIGHUP'));
	process.once('beforeExit', shutdown('beforeExit'));
}

// Wire an AbortSignal to a child: aborting fires SIGTERM, then SIGKILL
// after `killAfterMs` if the child hasn't exited.
export function attachAbortSignal(
	child: ChildProcess,
	signal: AbortSignal | undefined,
	killAfterMs = 5000,
): void {
	if (!signal) return;
	if (signal.aborted) {
		child.kill('SIGTERM');
		return;
	}
	const onAbort = () => {
		try {
			child.kill('SIGTERM');
			setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) {
					try {
						child.kill('SIGKILL');
					} catch {
						/* best effort */
					}
				}
			}, killAfterMs).unref();
		} catch {
			/* best effort */
		}
	};
	signal.addEventListener('abort', onAbort, {once: true});
	child.once('exit', () => signal.removeEventListener('abort', onAbort));
}
