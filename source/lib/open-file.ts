// Best-effort cross-platform "open this file in the default app".
// Used by view-template-diff to pop the diff PNG into Preview / your
// image viewer of choice without making the user navigate Finder.
// Returns true if a launcher was spawned, false if the platform is
// unrecognised. Errors from the launcher are swallowed — the caller
// always reports the path so the user can open it manually.
import {spawn} from 'node:child_process';

export function openFileInDefaultApp(path: string): boolean {
	try {
		if (process.platform === 'darwin') {
			spawn('open', [path], {detached: true, stdio: 'ignore'}).unref();
			return true;
		}
		if (process.platform === 'win32') {
			// `start` is a cmd.exe builtin; the empty "" is start's title arg.
			spawn('cmd', ['/c', 'start', '""', path], {
				detached: true,
				stdio: 'ignore',
			}).unref();
			return true;
		}
		// Linux + BSDs.
		spawn('xdg-open', [path], {detached: true, stdio: 'ignore'}).unref();
		return true;
	} catch {
		return false;
	}
}
