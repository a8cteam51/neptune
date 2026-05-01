---
description: Visual-diff a single rendered WP_Post / WP_Page body against its Figma body design and apply refinements so the rendered content matches Figma. Uses a measure-first / vision-fallback diff strategy.
argument-hint: [template-name] [page-url]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(gh issue create:*), Bash(gh repo view:*), Bash(studio wp:*), Bash(rm:*), Bash(cat:*), Bash(curl:*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh:*), Skill, mcp__figma__*, mcp__wordpress-studio__*
---

Read `${CLAUDE_PLUGIN_ROOT}/references/refine-content.md` and follow it end-to-end.
