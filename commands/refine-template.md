---
description: Visual-diff a rendered template/part against its Figma design and apply refinements so the rendered output matches Figma. Uses a measure-first / vision-fallback diff to catch sub-pixel and typographic discrepancies that vision alone misses.
argument-hint: [template-or-part-name] [site-url]
allowed-tools: Read, Edit, Write, Glob, Grep, Task, Bash(gh issue create:*), Bash(gh repo view:*), Bash(npm run build:styles:block-styles), Bash(studio wp:*), Bash(curl:*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh:*), Skill, mcp__figma__*, mcp__wordpress-studio__*
---

Read `${CLAUDE_PLUGIN_ROOT}/references/refine-template.md` and follow it end-to-end.
