// Minimal ANSI escape stripper. Used when surfacing child-process stderr
// to the Ink UI — colour codes from the child render as garbled box
// characters in our log views, and tokens embedded in URLs (which git
// echoes on clone failure) look out of place there too.
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]|\x1B\][^\x07]*\x07/g;

export function stripAnsi(input: string): string {
	return input.replace(ANSI_RE, '');
}

// Mask basic-auth credentials in a URL: https://user:token@host/... →
// https://***:***@host/.... Best-effort; only catches forms that match
// the URL parser, which is what git echoes on clone failure.
export function redactUrlCredentials(input: string): string {
	return input.replace(
		/(https?:\/\/)([^/\s@:]+):([^/\s@]+)@/g,
		'$1***:***@',
	);
}
