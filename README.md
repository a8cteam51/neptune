# Neptune

Neptune is an interactive CLI that turns Figma designs into working WordPress block themes. It pulls a page from Figma (Tailwind TSX + variables + screenshot), runs a local WordPress site under [Studio](https://developer.wordpress.com/studio/), and uses the configured agent provider to convert each pull into Gutenberg block markup, a `theme.json`, and any block style variations the design needs. Refinements happen by capturing the live render, diffing it against the design, and applying only the differences.

The intent is to keep the human at the menu — Neptune drives Figma, the file system, the Studio site, and the agents. Failures stop early and surface in the UI, so a paid agent call only fires when its inputs are good.

## Install

```bash
git clone <this repo>
cd neptune
npm install
npm run build
node dist/cli.js
```

You'll also need:

- Studio for Mac/Windows running, with at least one site created (for local WP).
- Figma's MCP server enabled (the plugin pulls TSX, assets, dev notes via MCP).
- An Anthropic API key for the default Claude provider, or Codex authentication / API key if `neptune-config.json` sets `"provider": "codex"`.

## What it does

The menu is grouped into Figma → Styles → Patterns → Content → Templates → End-to-end, matching the order you'd typically work through a project.

| Step                 | What you do                                                                                        | What Neptune does                                                                                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setup / Load Project | Pick a folder, name the project, point at the WordPress repo                                       | Initialises `neptune-config.json`, clones `wp-content`, creates the Studio site, uploads a placeholder image                                                                                                                                                                                     |
| Pull template        | Select a frame in Figma, fill in the page name + WP template file (`index.html`, `header.html`, …) | Asks Figma's MCP for `code.tsx`, `screenshot.png`, `variables.json`, `metadata.xml`, dev notes; writes `design/<slug>/`                                                                                                                                                                          |
| Verify screenshots   | —                                                                                                  | Re-renders each design and re-captures so you know the source-of-truth screenshot still matches what Figma gives you                                                                                                                                                                             |
| Build theme.json     | —                                                                                                  | Merges every pull's `variables.json` into `variables/all-variables.json`, then asks the `theme-json` skill to map tokens onto a block-theme `theme.json`                                                                                                                                         |
| Extract patterns     | —                                                                                                  | Scans every pull's `code.tsx` for non-default top-level functions, presents a checkbox list of unique names, persists your selection to `config.patterns`                                                                                                                                        |
| Pull pattern         | Pick a pattern from your config, select its Figma frame, press Enter                               | Pulls the four Figma artifacts into `patterns/<Name>/`. R re-reads the Figma selection from the picker; rows already pulled show as `(pulled)`.                                                                                                                                                  |
| Build patterns       | Toggle off any patterns you don't want (every row starts checked)                                  | For each `patterns/<Name>/code.tsx`, runs the `tsx-to-pattern` skill (with the pattern's screenshot, theme.json, variables, and existing variations inventory) and writes `<theme>/patterns/<kebab-slug>.php`                                                                                    |
| Build contents       | Toggle off any pulls you don't want                                                                | For each `usesPostContent` pull, sends `code.tsx`, `theme.json`, variables, screenshot, dev notes, and existing block style variations to the `tsx-to-blocks` skill; writes the `data-neptune-annotations="post-content"` subtree as the body of the matching `wp_post` (page)                   |
| Refine contents      | Toggle off any pulls you don't want                                                                | For each `usesPostContent` pull, captures the live page in headless Chromium, diffs against `screenshot.png` with [odiff](https://github.com/dmtrKovalenko/odiff), runs the `visual-diff` skill scoped to the post-content body, then `apply-diff` to update the page. Auto-approves every diff. |
| Build templates      | Toggle off any pulls you don't want                                                                | For each non-content-only pull, sends the same context to `tsx-to-blocks` and writes the resulting block markup into the `wp_template` / `wp_template_part` row. `usesPostContent` pulls emit a wrapper around a `wp:post-content` placeholder.                                                  |
| Refine templates     | Toggle off any pulls you don't want                                                                | Same capture/diff/apply pipeline as Refine contents but against the wrapper template's `wp_template` / `wp_template_part`                                                                                                                                                                        |
| View template diff   | Pick a pull                                                                                        | Re-runs only the capture+odiff step so you can inspect drift without paying for an agent call                                                                                                                                                                                                    |
| End-to-end build     | Confirm                                                                                            | Runs the full pipeline in order — `theme.json → patterns → content → templates → refine content → refine templates` — auto-approving every diff. Reports total tokens, USD cost, and runtime at the end.                                                                                         |

## User flow

```mermaid
flowchart TD
    Start(["Launch neptune"]) --> Setup["Setup / Load Project"]
    Setup -->|"neptune-config.json,<br/>wp-content cloned,<br/>Studio site,<br/>placeholder image"| Pull["Pull template"]
    Pull -->|"design/&lt;slug&gt;/<br/>code.tsx, screenshot.png,<br/>variables.json, metadata.xml,<br/>meta.json"| Theme["Build theme.json"]
    Theme -->|"wp-content/themes/&lt;slug&gt;/theme.json"| Extract["Extract patterns<br/>(select names → config.patterns)"]
    Extract --> PullPat["Pull pattern<br/>(per name)"]
    PullPat -->|"patterns/&lt;Name&gt;/<br/>code.tsx, screenshot.png,<br/>variables.json, metadata.xml,<br/>meta.json"| BuildPat["Build patterns"]
    BuildPat -->|"&lt;theme&gt;/patterns/&lt;slug&gt;.php"| BuildCt["Build content"]
    BuildCt -->|"wp_post body"| BuildTpl["Build templates"]
    BuildTpl -->|"wp_template /<br/>wp_template_part"| Refine["Refine content"]
    Refine -->|"capture + diff + auto-apply"| RefineTpl["Refine templates"]
    RefineTpl -->|"capture + diff + auto-apply"| Done(["Done"])

    classDef agent fill:#4f46e5,stroke:#818cf8,color:#fff
    class Theme,BuildPat,BuildCt,BuildTpl,Refine,RefineTpl agent
```

The arrows are forward-only because each step is gated on the previous step's artefact landing on disk or in the database — `listPulls()` reads `design/<slug>/meta.json`, the menu reads `neptune-config.json`, and the build commands check for `themeSlug` before showing up. **End-to-end build** runs all six "build / refine" stages in this order in one shot, aggregating token totals and USD cost across every agent call.

## Architecture

Neptune is a small Ink (React-in-the-terminal) app that orchestrates four kinds of side effects: Figma MCP calls, file system writes, Studio's `wp-cli` MCP, and the configured agent SDK. Each command is a self-contained `runX(...)` async function — the React component is a thin shell around it.

```
source/
  app.tsx                       Top-level menu, project-state machine
  cli.tsx                       Entry point, argv parsing
  commands/
    setup-project/              Multi-step config wizard
    pull-template/              Figma node → design/<slug>/
    pull-pattern.tsx            Figma node → patterns/<Name>/
    build-theme-json.tsx        variables → theme.json
    build-template.ts           Headless runBuild helper (used by build-templates.tsx)
    build-templates.tsx         Build templates picker UI — toggles a deselectable list, runs runBuild per row
    build-content.ts            Headless runBuildContent helper
    build-contents.tsx          Build contents picker UI — runs runBuildContent per row
    build-patterns.tsx          patterns/&lt;Name&gt;/code.tsx → &lt;theme&gt;/patterns/&lt;slug&gt;.php (UI + headless runBuildPattern in one file)
    refine-template.ts          Headless runDiagnose / runApply helpers
    refine-templates.tsx        Refine templates picker UI — capture + odiff + agent fixes per row
    refine-content.ts           Headless runDiagnoseContent / runApplyContent helpers
    refine-contents.tsx         Refine contents picker UI
    extract-patterns.tsx        Selection UI — discovers candidate names, persists to config.patterns
    extract-patterns-parse.ts   Brace-matching scanner for top-level functions in code.tsx
    e2e.tsx                     End-to-end orchestrator — runs every build/refine stage and aggregates usage
    verify-screenshots.tsx      Re-capture-and-diff against the source-of-truth screenshot
    view-template-diff.tsx      Capture + odiff with no agent call
  lib/
    agent-stream.ts             Agent SDK driver — Claude by default, Codex when configured; emits a structured `usage` LogEvent per call
    event-list.tsx              Streaming event list renderer
    sectioned-menu.tsx          Top-level menu with non-selectable section headers
    multi-select.tsx            Checkbox list (used by every "toggle off what you don't want" picker)
    menu.tsx                    Single-pick menu
    build-envelope.ts           Validates JSON envelopes from agents
    theme-json-patch.ts         Reads/writes theme.json + block style variations
    patterns.ts                 Pattern slug + PHP file serialiser + envelope parser; `listPatternSources` reads patterns/&lt;Name&gt;/code.tsx
    browser-capture.ts          Playwright headless capture
    odiff-runner.ts             Pixel diff
    template-diff.ts            Pad + diff orchestration
    wp-templates.ts, wp-pages.ts, wp-cli.ts, neptune-cli.ts   Studio MCP wrappers
    design-walk.ts              Pull discovery / metadata
    build-variables.ts          variables/* merge
    dev-annotations.ts          Designer notes extraction
    atomic-write.ts             tmp-file-then-rename writes
  integrations/
    figma/                      MCP session, asset download, handoff parser
    studio/                     MCP session, Studio site detection
    wordpress/                  WordPress install, wp-content clone
  plugins/neptune-tools/
    skills/
      tsx-to-blocks/SKILL.md    Source-of-truth prompt for the build agents
      tsx-to-pattern/SKILL.md   Source-of-truth prompt for the build-patterns agent
      apply-diff/SKILL.md       Source-of-truth prompt for the refine agent
      visual-diff/SKILL.md      Source-of-truth prompt for the diff agent
      theme-json/SKILL.md       Source-of-truth prompt for theme.json builder
```

Key invariants the codebase enforces:

- **Project state lives on disk, not in memory.** `neptune-config.json` is the source of truth for "what's been set up," and `design/<slug>/meta.json` is the source of truth for "what's been pulled." The menu reads these on every refresh; nothing is cached across runs.
- **Atomic writes everywhere.** Every file write goes through `lib/atomic-write.ts` (`writeFileAtomic`), which writes to a tmp file in the same directory and renames into place. A killed process never leaves a half-written `theme.json`.
- **One agent call per envelope.** Build and refine agents return a single JSON envelope with `template_html`, an optional `theme_json_patch`, and an optional `block_style_variations[]`. Neptune persists all three; the agent never calls `Write`/`Edit` itself.
- **Existing block style variations are inventoried and reused.** Before each build/refine, Neptune reads `<theme>/styles/blocks/*.json` and feeds the inventory to the agent. If a header and footer need the same alternate button style, they share one `is-style-neptune-<slug>` instead of registering it twice.
- **Studio is the only WP runtime.** Database writes go through Studio's `wp-cli` MCP (`lib/wp-cli.ts`); we never edit `wp_posts` rows directly. The cache is flushed after every `theme.json` mutation so changes show up on the next pageload.
- **Every paid path has a confirm-overwrite gate.** Build / refine commands check the database for an existing row first and prompt before overwriting, so a misclick can't burn an agent call you didn't mean to make.

## Data flow: Figma → blocks

```mermaid
flowchart LR
    subgraph Figma
        F1["Frame node URL"]
    end

    subgraph Local["Local filesystem"]
        D1["design/&lt;slug&gt;/code.tsx"]
        D2["design/&lt;slug&gt;/screenshot.png"]
        D3["design/&lt;slug&gt;/variables.json"]
        D4["design/&lt;slug&gt;/meta.json"]
        V["variables/<br/>all-variables.json"]
        PT["patterns/&lt;Name&gt;/<br/>code.tsx, screenshot.png,<br/>variables.json, metadata.xml,<br/>meta.json"]
    end

    subgraph Theme["Theme files"]
        TJ["theme.json"]
        BS["styles/blocks/<br/>neptune-*.json"]
        PP["patterns/<br/>&lt;slug&gt;.php"]
    end

    subgraph DB["WordPress DB (via Studio)"]
        WT["wp_template /<br/>wp_template_part"]
        WP["wp_post"]
    end

    subgraph Agents["Agent skills"]
        TT["tsx-to-blocks"]
        TP["tsx-to-pattern"]
        TJB["theme-json"]
        VD["visual-diff"]
        AD["apply-diff"]
    end

    F1 -->|"Figma MCP"| D1
    F1 -->|"Figma MCP"| D2
    F1 -->|"Figma MCP"| D3
    F1 -->|"pull metadata"| D4

    D3 -->|"build-variables<br/>first-write-wins merge"| V
    V --> TJB
    TJB -->|"full theme.json"| TJ

    D1 --> TT
    D2 --> TT
    D3 --> TT
    TJ --> TT
    BS -->|"existing variations<br/>inventory (reuse)"| TT
    TT -->|"template_html"| WT
    TT -->|"theme_json_patch<br/>(deep-merged)"| TJ
    TT -->|"block_style_variations[]"| BS

    TT -.->|"when usesPostContent:<br/>post-content subtree"| WP

    D1 -.->|"extract-patterns scans for<br/>non-default top-level<br/>function names → config.patterns"| Cfg["neptune-config.json<br/>config.patterns: string[]"]
    Cfg -->|"pull-pattern: one Figma pull<br/>per selected name"| PT
    PT --> TP
    TJ --> TP
    BS --> TP
    TP -->|"template_html<br/>+ pattern metadata"| PP
    TP -->|"theme_json_patch"| TJ
    TP -->|"block_style_variations[]"| BS

    WT -->|"Playwright capture"| LIVE["live.png"]
    LIVE --> ODIFF["odiff"]
    D2 --> ODIFF
    ODIFF -->|"diff.png"| VD
    VD -->|"diff report JSON"| Review["User review<br/>(MultiSelect)"]
    Review -->|"approved diffs"| AD
    AD -->|"template_html"| WT
    AD -->|"theme_json_patch"| TJ
    AD -->|"block_style_variations[]"| BS

    classDef agent fill:#4f46e5,stroke:#818cf8,color:#fff
    classDef tool fill:#065f46,stroke:#10b981,color:#fff
    class TT,TP,TJB,VD,AD agent
    class ODIFF,Review tool
```

Read it as five loops:

1. **Pull loop** — Figma MCP → `design/<slug>/` files. No agents involved; Neptune is just a smart download client. The slug comes from the page name, the `templateFile` mapping comes from the user's pick at pull time, and the `meta.json` carries everything downstream commands need so they don't have to re-ask Figma.

2. **Theme bootstrap** — every pull's `variables.json` merges into a single `variables/all-variables.json` (first-write-wins, conflicts logged), which feeds the `theme-json` skill. The output is a fully-formed block-theme `theme.json` with presets for color, typography, spacing, and layout. This happens once per project; subsequent pulls add new tokens by re-running.

3. **Pattern loop** — `extract-patterns` walks every pulled `code.tsx`, dedupes non-default top-level function names across pulls, and writes the user's selection to `config.patterns` in `neptune-config.json`. `pull-pattern` then runs one Figma pull per selected name, writing `patterns/<Name>/{code.tsx, screenshot.png, variables.json, metadata.xml, meta.json}`. `build-patterns` runs `tsx-to-pattern` against each `patterns/<Name>/code.tsx` (with the screenshot, current `theme.json`, variables, and existing variations inventory as context) and writes `<theme>/patterns/<kebab-slug>.php`. The PHP file's header comment is the registration metadata WordPress core auto-discovers at boot — `Title:`, `Slug:`, `Categories:`, `Block Types:`, `Viewport Width:`, `Inserter:`, `Description:`, `Keywords:`. The agent never emits PHP; Neptune wraps the block markup in the docblock header itself. Patterns share the same `theme.json` and block-style-variations inventory as the template build, so a button variation declared by a template is reused by a pattern instead of being duplicated.

4. **Content + template build loop** — Build content runs first because `usesPostContent` pulls embed `wp:post-content` in their wrapper, and templates are the wrappers. Each pull runs `tsx-to-blocks` against its `code.tsx` plus the current `theme.json`, the variables index, dev notes, the screenshot, and the existing variations inventory. The envelope it returns updates three things atomically: the database row for the template (or page post), `theme.json` (deep-merged into `styles.blocks` and `settings.custom` only), and `<theme>/styles/blocks/*.json` for new variations.

5. **Refine loop** — same envelope shape, different prompt: capture the live render in headless Chromium, diff against `screenshot.png` with odiff, run the `visual-diff` skill on the resulting image triple, then `apply-diff` to fold the approved diffs back into the existing markup / theme.json / variations. Refine content first, then refine templates. The end-to-end orchestrator auto-approves every diff the visual-diff agent reports.

## Styling priority

Both build and refine agents follow the same cardinal rule, codified in `tsx-to-blocks/SKILL.md` and `apply-diff/SKILL.md`:

1. A `theme.json` preset slug, when one already matches.
2. A pre-exposed structured property under `theme_json_patch.blocks["core/<x>"]` — color/typography/spacing/border/elements. Project-wide.
3. **Reuse** an existing block style variation by applying its `is-style-<slug>` class.
4. A new block style variation in `block_style_variations[]`, again using structured properties.
5. CSS, last resort — only when the rule cannot be expressed as a structured property (pseudo-selectors, descendant selectors, animations).

The agents see the existing variations inventory in their prompt, so option 3 actually fires — you don't get a duplicate `neptune-cta-fill` registered once for header.html and again for footer.html.

## Tests

```bash
npm test
```

Unit tests live under `test/unit/`. They cover the parsing and envelope-validation layers (`build-envelope`, `refine-template-parser`), the file-mutation primitives (`theme-json-patch`, `atomic-write`), the diff orchestration (`design-walk`, `template-scaffold`, `template-diff` helpers), and the WP wrappers' command shape (`wp-templates`, `wp-pages`, `wp-cli`). They deliberately don't try to spin up Studio or Figma — those are integration concerns and would be flaky in CI. The agent code paths are tested by mocking `runAgent` and feeding the parsers known envelope shapes.

## Configuration

Per-project state lives in `<project>/neptune-config.json`. The shape is in `source/commands/setup-project/types.ts`; the bits that matter to other commands are:

- `themeSlug` — the WP theme directory name. Required before build/refine.
- `provider` — agent SDK provider. Defaults to `claude`; set to `codex` to run agent tasks through the OpenAI Codex SDK. Codex receives the same `plugins/neptune-tools/skills/<name>/SKILL.md` instructions inline because its SDK does not accept Claude-style local plugin paths.
- `placeholderImage` — `{id, url}` for an attachment uploaded during setup. Build agents are told to use this for every `wp:image` block so live renders don't flash empty `src`s.
- `steps` — boolean map of which setup steps have completed. The wizard resumes from the first `false`.
- `design.pagesDir` — the Figma file URL used as the source of pulls.
- `patterns` — array of PascalCase pattern names the user selected in Extract patterns. Pull pattern lists these; End-to-end build refuses to start if any selected name lacks a pulled `patterns/<Name>/code.tsx`.
- `variablesBuiltAt` — ISO timestamp of the last `variables/all-variables.json` merge.

Per-pull state lives in `<project>/design/<slug>/meta.json` (`PullMeta` in `source/lib/types.ts`). Per-pattern state lives in `<project>/patterns/<Name>/meta.json` and is currently a small audit record (`name`, `selectionName`, `x`, `y`, `pulledAt`).
