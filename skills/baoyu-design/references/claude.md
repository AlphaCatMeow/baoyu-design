# Claude Code tools — reference

The harness-specific tools `system-prompt.md` relies on, for when you are running inside **Claude Code**. The main prompt only names capabilities ("ask the user", "preview", "screenshot", "debug"); this doc gives the exact Claude Code tool, signature, and call pattern. Generic tools (`Bash`, `Read`/`Write`/`Edit`/`Glob`, `gh`) are the same everywhere and aren't covered here.

## Web tool → Claude Code tool map

The upstream prompt references Claude.ai web tools that do not exist in Claude Code. Substitute as follows everywhere — prose and code alike:

| Web tool | Claude Code equivalent |
|---|---|
| `questions_v2` | `AskUserQuestion` (returns answers inline; up to 4 questions/call, follow-up call if more needed) |
| `done`, `fork_verifier_agent` | `SendUserFile` + the Claude Preview MCP; an `Agent` subagent for thorough checks — see "Verification & debug" below |
| `write_file` (and its `asset:` param) | `Write` — drop the "asset review pane" concept entirely |
| `copy_files` | `Bash cp` |
| `read_file`, `list_files`, `view_image` | `Read` (it renders images too), `Glob` / `Bash ls`, `Grep` |
| `show_to_user` | `SendUserFile` / `open <path>` |
| `eval_js`, `eval_js_user_view`, `run_script` | `Bash`; the Claude Preview MCP `preview_eval` for in-page JS |
| `web_fetch`, `web_search` | `WebFetch`, `WebSearch` |
| `copy_starter_component` | `Bash cp starter-components/<file> designs/<project>/` (or `Read` + adapt) |
| `invoke_skill("X")` / `invoke the "X" skill` | `Read` the matching `built-in-skills/<file>.md` |
| `/projects/<projectId>/<path>` | ordinary filesystem paths (relative to cwd, or absolute) |

## AskUserQuestion (clarifying questions)

Replaces `questions_v2`. `AskUserQuestion` **returns the user's answers inline** — ask, then continue once they respond. It shows up to 4 questions per call; for a large new project, ask a focused round and make a follow-up call if you need more.

- A remembered preference may be offered as a *suggested* default inside a question, but the user still confirms.
- Prefer it over listing choices as text bullets in your reply.

## Showing files & preview

To surface a deliverable, use `SendUserFile` with the file path (works for any file type — HTML, images, text). Reading a file does NOT show it to the user.

To open a prototype in a browser — whether for the user to interact with or for you to preview/screenshot it — **always serve it over HTTP and load the `http://localhost:<port>/<project>/<file>.html` URL; do not open the HTML directly from `file://`.** A multi-file prototype (an HTML entry that loads `<script type="text/babel" src="…jsx">` components) only works over HTTP — the browser blocks cross-origin local script reads — and self-contained single files go through the same served URL so preview and screenshots stay consistent.

Serve the whole `designs/` directory once (one server for all projects) and reuse it. Preview through the Claude Preview MCP, which serves from a named config in `.claude/launch.json`: define a single `designs` server that serves the whole `designs/` directory (`python3 -m http.server 4311 --directory designs`) so every project shares one server.

## Verification & debug

When the deliverable is ready, surface it (`SendUserFile`), preview it over the served URL, confirm it loads cleanly, and fix any errors before finishing. The user should always land on a view that doesn't crash.

Preview through the Claude Preview MCP:

1. `mcp__Claude_Preview__preview_start` with `{name: "designs"}` (the `designs` config in `.claude/launch.json`).
2. Open `http://localhost:<port>/<project>/<file>.html`.
3. `mcp__Claude_Preview__preview_console_logs` to catch JS errors.
4. `mcp__Claude_Preview__preview_screenshot` to inspect layout. Fix any errors and surface it again.

For thorough or directed checks ("screenshot and check the spacing"), spawn an `Agent` subagent to load the file, take screenshots, probe the JS, and report back — useful when you don't want to clutter your own context.

**Preview-harness gotchas (React + Babel prototypes)** — quirks of the Claude Preview MCP, not your code:

- `preview_click` does not reach React's delegated `onClick` (React 18 `createRoot` delegates from the root container). To fire a handler, use `preview_eval`: find the node, read its `__reactProps$*` key, and call `el[propKey].onClick({stopPropagation(){},preventDefault(){}})`. Real browser clicks are fine; this is harness-only.
- Global `keydown` listeners DO fire via `window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}))` — use this to test ⌘K / Esc / shortcuts.
- The screenshot surface desyncs after an in-page `location.reload()` or repeated custom resizes (the window renders tiny in a corner). Resync via `preview_resize` to a preset then back to your size; prefer `location.href = …` over `reload()`.

**If the preview MCP is unavailable,** fall back by file type. A fully self-contained single file can be opened with `open <path>` (`file://`); a multi-file prototype (`<script src="…jsx">`) will NOT load over `file://` and needs HTTP — start the `designs` server yourself (`python3 -m http.server 4311 --directory designs`) and open the URL, or spawn an `Agent` to verify. Never leave the user on a view that silently failed to load its components.
