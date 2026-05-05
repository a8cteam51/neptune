// ANSI escape stripper covering the CSI sequences we encounter from
// child processes: SGR colour codes (`\x1B[31m`), cursor moves
// (`\x1B[1A`, `\x1B[K`), DEC private modes (`\x1B[?25l`, `\x1B[?25h`),
// plus the OSC string form (`\x1B]title\x07`). Used when surfacing
// child-process stderr to the Ink UI and when slicing JSON out of
// Studio CLI stdout.
//
// CSI grammar: `\x1B[` then parameter bytes (0x30-0x3F: digits, `:`,
// `;`, `<`, `=`, `>`, `?`), then intermediate bytes (0x20-0x2F: space,
// `!`-`/`), then a final byte (0x40-0x7E: `@`, A-Z, `[`-`` ` ``, a-z,
// `{`-`~`). We don't try to validate semantics — strip and move on.
const ANSI_RE =
	/\x1B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]|\x1B\][^\x07]*\x07/g;

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
