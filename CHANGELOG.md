# Changelog

All notable changes to `baoyu-design` are tracked in this file.

## Unreleased

### Added

- Added end-to-end design-system support so a design project can follow an existing system: discovery, a sync step that copies a self‑contained, version‑pinned copy into `<project>/_ds/<slug>/`, page wiring, a generated per‑load binding prompt (`_ds_prompt.md`), and the binding recorded in `<project>/_d_meta.json` — documented in the new `use-design-system.md` built‑in skill.
- Added a portable design-system authoring pipeline: a compiler that bundles a system's tokens and React components for loading, a read-only checker (with a matching checker subagent) that validates a system without writing, and the `design-system-authoring-guide.md` flow.
- Added asset recording that indexes a project's deliverables and their review status in `_d_meta.json`, bootstrapping that metadata even when no design system is used.
- Added a read-only fork-verifier subagent (`agents/fork-verifier-agent.md`) for thorough post-build checks — it loads the served deliverable, catches console errors, screenshots the layout, and probes for overflow root causes and unresolved `var(--*)` tokens before returning a single done / needs-work verdict; the Claude Code, Cursor, and Codex harness references now resolve their `fork_verifier_agent` verification subagent to it.
- Added this changelog to keep project updates in one place.

### Changed

- Project setup now asks where to save the project and which design system(s) to use (none, one, or several); reopening a project reloads its bound design systems from `_d_meta.json` before designing.
- Documented importing and using existing design systems in the English and Simplified Chinese README files.
- Clarified that final design and prototype delivery should include the running preview, not only the generated file.
- Updated Claude Code, Codex Agent, and Cursor harness references to make final preview handoff visible to the user after verification.
- Updated the English and Simplified Chinese README files to document Codex Agent support, the new `references/codex.md` harness map, install examples, usage notes, and changelog links.

## 2026-06-06

### Added

- Added Codex Agent support with `skills/baoyu-design/references/codex.md`, covering question asking, browser preview, screenshots, debugging, deliverable surfacing, and subagent verification defaults.
- Added English and Simplified Chinese README files.
- Added the portable `baoyu-design` Agent Skill, core design methodology, built-in skill prompts, starter components, and harness reference docs for Claude Code and Cursor.
- Added the initial repository files and MIT license.

### Changed

- Updated the skill entry flow to detect Codex Agent and fall back cleanly for Claude Desktop-like or other file-capable harnesses.
- Reworded preview and verification instructions in built-in export skills so they route through the selected harness reference instead of hard-coded preview tool names.
