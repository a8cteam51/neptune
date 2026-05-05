# GitHub follow-up issues

Whenever a Neptune skill or command surfaces a follow-up that requires a human action — anything you cannot complete yourself, anything that needs a designer/PM/dev decision, or anything you've left a placeholder for in the theme — **open a GitHub issue in the project repo for it. This is the only acceptable way to communicate a follow-up.**

**Never list follow-ups inline in chat, run summaries, or final reports as a substitute for filing an issue.** Phrases like "follow-ups requiring human action:", "items to flag:", "TODO for the user:", or any bulleted list of tasks the user should do later are forbidden as the *destination* of a follow-up — they must always be backed by real `gh issue create` calls. The run summary may *reference* the issues you filed (URL + title, per "Closing the loop" below), but the human-actionable content lives in the issues, not in the chat output.

If you find yourself about to write "I'd normally open an issue but…" or "flagging here since…", stop. Either the `gh` call works (file the issue) or it fails (per step 5 below, stop and tell the user). There is no third path.

## Procedure

1. Obtain `repositoryUrl` from `neptune-config.json` (or from the `repositoryUrl` value already provided in your prompt if you are a subagent). Extract `<owner/repo>` by stripping the protocol and host: e.g. `https://github.com/acme/my-theme` → `acme/my-theme`. For SSH URLs (`git@github.com:acme/my-theme.git`) strip the host prefix and `.git` suffix.
2. Use `gh issue create --repo <owner/repo> --title "<short title>" --body "<body>"` (or `--body-file` for multi-line bodies).
3. The issue body must:
   - Describe what the human needs to do, in one or two short paragraphs.
   - Link to the relevant Figma frame (deep-link to the node ID where applicable) **and/or** quote the specific dev note from `neptune-config.json` that inspired the task.
   - End with a single line: `Issue created by Neptune.`
4. Open one issue per follow-up — do not bundle unrelated tasks. Bundling makes them harder to triage and close independently.
5. If `gh` is not authenticated or the call fails, stop and tell the user — do not silently drop the follow-up.

## When to open an issue (non-exhaustive)

- A `wp:html` block would be the only way to achieve a goal — leave a placeholder paragraph block in the markup and open an issue describing what needs to be wired up.
- A header/footer nav label has no matching `templateMappings` entry — leave a `#` href and open an issue listing the unwired labels.
- A dev note describes work outside the current command's scope (e.g. JS behavior, plugin install).
- A `templateMappings` entry has no `figmaNodes` and you cannot resolve them — issue describes which entry needs human-led mapping.
- Any design ambiguity you resolved with an assumption — record the assumption in the issue so the human can confirm or correct.

## Closing the loop

At the end of each command run, list every issue you opened (URL + title) so the user has a single place to triage them. This is a list of *filed* issues, not a list of things you decided not to file — every entry must be a real GitHub URL.
