# Upstream Issue Triage — Nimbalyst/nimbalyst

Snapshot: 2026-05-19   Source: `gh issue list -R Nimbalyst/nimbalyst --state open --limit 200`
Total open issues: 115

Buckets:
- Already fixed by our hardening fork: 0
- Critical issues: 7
- Easy wins: 28
- Ignore: 80

Note: none of the open upstream issues describe a problem our hardening fork already eliminates. Our fork removed/locked-down telemetry, auto-update, font/icon CDNs, plaintext API keys, the eval IPC channel, the `/clip` CORS wildcard, AppleScript injection, the zip-slip path, and a handful of risky deps — none of these surfaced as an upstream open ticket as of the snapshot. The "Already fixed" table is therefore intentionally empty; it is left in the document so future re-runs can populate it without restructuring.

---

## Already fixed by our hardening fork (0)

| # | Title | Why our fork closes it |
|---|---|---|
| — | (none) | No open upstream issue corresponds to a vulnerability or behavior already neutralized by commits a62e2251 / c99f7e1a / 4a7c66d2 / 5004603b. |

---

## Critical issues (7)

Sorted by issue number descending.

| # | Title | One-line context | Why critical | Likely effort |
|---|---|---|---|---|
| 365 | Renderer process killed under multi-session load (PGLite saturation, edit-queue overflow, 100% CPU) | 2–3 concurrent AI sessions + moderate KB tree → WorkspaceFileEditAttribution queue overflows, PGLite blocks 3 s+, main-process CPU pegged ~30 s, renderer is killed. Pre-crash logs already pinpoint the culprits. | Blocks normal multi-session usage (a flagship feature). Likely data loss risk if the renderer dies mid-edit. Reproducible class of failure across #343 and #238 as well. | Medium-large — touches queue backpressure and PGLite write concurrency. |
| 351 | Linux AppImage v0.60.1 login issue | OAuth callback delivered via `nimbalyst://auth/callback?...` arrives with **empty** `session_token`, `session_jwt`, `expires_at` — the xdg handler strips the auth params before they reach the app. User cannot sign in at all on Linux AppImage. | Total auth failure for a supported platform; cloud features (sync, teams, login-gated provider keys) are unreachable. | Small-medium — fix the protocol-handler argv parsing / desktop file entry. |
| 343 | App closes when running ~3 sessions in parallel (manual tabs) | Whole Nimbalyst window closes after opening a third tab/session on Windows 11 0.60.1. Same failure class as #365 and #238. | Hard crash + complete window loss; reliably reproducible at very low concurrency. Treat together with #365 root-cause work. | See #365. |
| 308 | Team sync broken: JWT not org-scoped before WebSocket auth, cascades to OrgKeyService and TrackerSync | Users in both personal + team org get a personal-org Stytch B2B JWT; CollabV3 uses the team-org userId for room routing; server rejects, then OrgKeyService and TrackerSync also fail. | Hard-breaks the entire team/sync product for any user with mixed org membership — a likely common configuration. Cascade also corrupts tracker sync. | Medium — add `sessions.exchange()` to the auth path before WebSocket handshake; thread org context. |
| 298 | Codex document edits can bypass Nimbalyst's visual review diff | Codex hits a generic file-edit path that skips Nimbalyst's red/green inline review; content is mutated without user visibility/consent. | Silently bypasses the user's review safety boundary — same trust-model failure that #344/#359/#367 partially encroach on, but here the user **never** sees the change before it lands. Easy to lose work. | Medium — route Codex edits through the same diff/review pipeline as other agents. |
| 269 | Pasted-text attachments intermittently dropped on send (window blur/refocus) | `pasted-text-<ts>.txt` is referenced via `@`-mention but the `<NIMBALYST_SYSTEM_MESSAGE><LARGE_ATTACHMENTS>` resolution block is only appended ~half the time, tied to focus changes; agents then act on requests with the attachment silently missing. | Silent data loss in chat — agents execute on instructions while missing the user's pasted context. Hard to detect, easy to act wrongly on. | Medium — sequence the attachment resolution before send regardless of focus state. |
| 238 | App freezes with multiple running agent sessions; subsequent relaunch fails with "Request init timed out" | ~3 sessions → UI freezes → forced close → next launch fails with DB init timeout. Same crash class as #365/#343, plus the second-order DB lock failure that bricks restart. | Multi-session crash already covered by #365; additionally documents the **database-init-timeout-on-restart** mode that can leave a user unable to relaunch — escalates from crash to "app won't start." | See #365 plus a recovery path for stale PGLite locks. |

Secondary critical-adjacent (kept in Easy Wins where the fix is small): #297 (silent hide of `dist` folders — surprising data invisibility but easy fix), #57 (broken Login button on Tahoe — entitlement add), #22 (microphone entitlement missing).

---

## Easy wins (28)

Sorted by issue number descending. Effort is rough: S = small (a few hours), M = medium (a day-ish). `good-first-issue` label noted where present upstream.

| # | Title | One-line scope | good-first-issue? | Estimated effort |
|---|---|---|---|---|
| 382 | "Show recent commits" widget shows nothing — developer_git_log fails when receiving a directory path | One MCP tool argument handling fix. | no | S |
| 380 | EPIPE issue with AppImage | Port-collision diagnostic; surface a friendly error rather than a popup storm. | no | S |
| 376 | ScheduleWakeup payload rendered as a user message in chat transcript | Tag/`isMeta` filter at the transcript render boundary. | no | S |
| 375 | "Always" allow scope on MCP tool permissions does not persist | Persist the per-tool permission record across re-prompts within the same session. | no | S |
| 374 | Respect `CLAUDE_CODE_AUTO_COMPACT_WINDOW` env var (+ settings UI) | Read env var, expose toggle in settings. | no | S |
| 372 | Search in source mode does not highlight or scroll to match position | Wire Monaco find decoration + reveal in source-mode editor. | no | S |
| 367 | Manual unsaved changes lost when renaming a file via F2 in the file tree | Carry editor dirty state across rename. | no | S |
| 360 | Add keyboard shortcut to toggle Files Edited sidebar visibility | New shortcut + KeyboardShortcutsDialog update. | no | S |
| 359 | File tree and editor tabs don't update after AI session edits | Likely a missing IPC fan-out from existing file-watcher into editor refresh. | no | S-M |
| 354 | Assistant-message `@file` mentions render as plain text, not as clickable file links | Renderer pass over assistant messages mirroring user-message link logic. | no | S |
| 353 | Ctrl+Alt+1 in markdown editor also switches to tab 1 on Linux | Suppress chord propagation when editor owns the chord on Linux. | no | S |
| 347 | Commit completion lacks user feedback in meta-agent workflow | Post a status event back to the chat after `developer_git_commit_proposal` resolves. | no | S |
| 344 | Stop button remains active after agent reports task complete | Resolve the turn on terminal assistant message; clear `isRunning`. | no | S |
| 342 | Toggling Source ↔ WYSIWYG view loses cursor and scroll position | Cache/restore selection + scroll across view toggle. | no | S-M |
| 341 | Find (Ctrl+F): match count is shown but matches are not highlighted nor scrolled to | Same root as #372 (Lexical search). One fix may cover both. | no | S |
| 340 | Second-instance "open file" signal is queued but not rendered until a different file is opened | Drain `second-instance` queue immediately after window ready. | no | S |
| 338 | Open worktree in external app (dropdown with auto-discovered apps + hotkeys) | Polish on existing "open in" path. | no | S-M |
| 334 | SDK auto-injects "Continue from where you left off." META message before every user turn | Suppress the meta message in the SDK adapter or filter at the boundary. | no | S |
| 304 | `@` mention with empty query shows alphabetical files instead of recently viewed | Sort order branch when query is empty. | no | S |
| 303 | `@`-mention picker before typing shows incomplete recently-viewed files | Source list bug — likely a debounce/state race. | no | S |
| 297 | Folders named `dist` are silently hidden from the file tree | Stop applying gitignore-style hide to user-created folders, or surface an indicator. | no | S |
| 282 | Right-click → Archive on a session is a no-op | Wire the action handler that already exists for the keyboard path. Could also be **Critical** — moved here because fix is trivial. | no | S |
| 192 | Worktree branch switcher + current branch indicator in status bar | New status-bar element + dropdown. | no | M |
| 159 | Brand the Nimbalyst interface from a Claude brand skill or design toolkit | Cosmetic / theming pass; mostly token swaps. | no | S-M |
| 124 | Multi-root workspace support: scope Claude CLI to a subfolder while keeping UI at the repo root | Pass `--cwd` from session to CLI based on a per-session subroot setting. | no | M |
| 106 | Build a custom extension (pinned issue, don't work in this issue) | Already labelled `contributor:good-first-issue` — but explicitly "don't work in this issue," so it's a meta-pin; **list-only**. | **yes** (meta-pin only) | n/a |
| 62 | Support Custom Configuration File Path for Claude Code (settings.json) | Surface a settings field; pass `--settings <path>` through. | no | S |
| 46 | Agent/Plan support in Codex like in Claude | Reuses existing UI; backed by Codex adapter changes. | no | M |

(Total in this table: 28. Issue #106 is included for completeness but is a non-work pinned issue.)

---

## Ignore (80)

Sorted by issue number descending.

| # | Title | Reason |
|---|---|---|
| 383 | `developer_git_commit_proposal`: support repos outside workspace root | Niche workflow; not affecting our fork's use. |
| 377 | Allow the destination folder to be chosen during installation | We don't ship a Linux installer; not material. |
| 373 | Navigation history — Back and Forward buttons | Feature wish; nice but not impactful. |
| 371 | Add auto mode to the existing agent/plan mode switcher | Feature wish; upstream-roadmap territory. |
| 370 | Allow AI response area to expand to full available width | Cosmetic preference. |
| 368 | Commit proposal widget can appear only after a later assistant turn | Edge case; needs upstream timing fix. |
| 366 | AskUserQuestion can stay "thinking" and queue user reply instead of resolving | Real bug, but inside upstream meta-agent path we don't rely on. Defer. |
| 364 | Add side-by-side (horizontal) agent/file layout option | Feature wish. |
| 363 | Inline AI diff renders multiple copies of embedded files | Excalidraw-specific renderer issue; not in critical path. |
| 361 | Add more notification sound options | Wishlist. |
| 352 | Editor freezes during rapid external file changes | Real, but covered by larger #365 work; redundant ticket. |
| 350 | spawn_session: workspace-level model governance | Feature wish for cost guardrails. |
| 349 | Project tray groupings + per-window pinned projects don't persist | Multi-window state bug, niche; defer. |
| 348 | Chat: message timestamps + agent sender name for meta-agent messages | UX polish wish. |
| 346 | Meta-agent ignores user instructions about session reuse | Meta-agent path we don't drive. |
| 345 | Meta-agent spawns sub-sessions for single tool calls | Meta-agent. |
| 339 | Excalidraw editor fails to mount in hidden tab; MCP tools time out | Extension-side; works fine if tab visible. |
| 329 | CSV editor: cell label, date format, currency/percent, Cmd+B/U, diff state bugs | CSV extension polish. |
| 328 | csv-spreadsheet: AI edits are auto-accepted, no red/green pending-review diff | CSV-specific; not in our risk surface. |
| 324 | Voice Mode buttons don't trigger macOS mic permission prompt (Tahoe 26.2) | Voice Mode — feature we don't use. (#22 covers the entitlement.) |
| 322 | Multi-pane tiling: vertical split + mixed agent/file groups | Feature wish. |
| 310 | 支持简体中文界面语言 / Support Simplified Chinese UI language | i18n feature wish. |
| 307 | Integrated PR review panel (MVP) | Feature wish. |
| 296 | OpenAI Codex provider fails in Nimbalyst while Codex CLI works | Provider-integration bug; we don't use this provider in fork. |
| 273 | Drill-down Kanban view for per-session tasks | Feature wish. |
| 271 | Add vertical orientation option for doc/agent split view | Feature wish. |
| 268 | Support Devin for Terminal | Feature wish. |
| 266 | Per-message delete and branch-from-message for session transcripts | Feature wish. |
| 264 | New Worktree button: base branch selector dropdown | Feature wish. |
| 259 | Create a button to refresh the files | Wishlist; trivial workaround exists. |
| 258 | Custom Claude executable wrapper broken on Windows in v0.60 | Windows-specific edge case; not our platform. |
| 246 | Add a calendar view to tracker boards | Feature wish. |
| 244 | Filter sessions list by tag | Feature wish. |
| 241 | Add a view for the main session's current task list | Feature wish. |
| 237 | Add proper RTL (Right-to-Left) support for agent responses and text rendering | i18n wish. |
| 224 | Extremely slow response streaming (Codex GPT-5.5) | Provider-side throttling, not our fork. |
| 213 | Quote reply — reply to selected text in AI messages | Feature wish. |
| 186 | RTK integration for context compression | Speculative feature. |
| 173 | Customizable submit / newline keybinding for chat input | Feature wish. |
| 172 | Support for Jujutsu (jj) version control alongside git | Feature wish. |
| 171 | Default inline file view to diff instead of full file contents | Preference. |
| 151 | Clarify parent/child ownership after direct child takeover | Edge case; rare in our flow. |
| 137 | Math rendering (KaTeX) in the document editor | Feature wish. |
| 135 | Programmable action buttons | Feature wish. |
| 134 | (empty title) Codex .toml startup flags conflict | Codex-only; not our fork. |
| 126 | Add Portuguese (PT-BR) language support | i18n wish. |
| 115 | Linear MCP OAuth flow loses state between assistant turns | Niche MCP; already `status:in-progress` upstream. |
| 102 | Vertex AI Support | Feature wish (provider). |
| 101 | GitHub Copilot Agent | Feature wish (provider). |
| 100 | Qwen Code Support | Feature wish (provider). |
| 99  | CSV Extension Improvements | Extension feature wish. |
| 98  | AWS Bedrock Support | Feature wish (provider). |
| 97  | LM Studio Improvements | Feature wish. |
| 96  | Gemini Coding Agent | Feature wish (provider). |
| 95  | Android Mobile App | We ship desktop only. |
| 94  | Meta Agent | Feature wish. |
| 93  | OpenCode Agent | Feature wish. |
| 89  | Voice Mode | Feature we don't use. |
| 82  | Custom session Kanban column names | Feature wish. |
| 78  | Tracker session linking missing key operations | Feature wish. |
| 77  | Revert to chat | Feature wish. |
| 74  | Support OpenAI gpt-image-2 in Codex sessions | Provider wish. |
| 69  | Vim mode support | Feature wish. |
| 66  | Full session lifecycle management via MCP | Feature wish. |
| 57  | Login/Logout silently fail on macOS Tahoe — missing automation entitlement | Real bug but we **strip the apple-events automation path** anyway in hardening; safer to keep that surface closed than to add the entitlement back. Re-evaluate only if a user complaint surfaces. |
| 55  | Warning when CLAUDE.md / memory.md becomes too large | Feature wish. |
| 49  | Use Nimbalyst on Remote SSH | Feature wish. |
| 48  | Visible "Thinking" or reasoning trace in Codex | Codex provider. |
| 47  | Add editor selection to inline text in chat as contextual reference | Feature wish. |
| 43  | Load MCP servers from `~/.claude/.mcp.json` | Feature wish. |
| 40  | WSL/Windows + LM Studio auth header failure | Platform combo we don't ship. |
| 37  | Codex multiagent worktree/subagent orchestration issues | Codex provider. |
| 26  | Native WSL execution support for Windows users | Platform we don't ship. |
| 22  | Microphone entitlement missing on macOS | Same call as #57 — voice mode is **not used** in our fork; keeping the entitlement off is safer. |
| 18  | Claude Code Thinking Trace | Feature wish. |
| 3   | Make built-in Claude Code commands with interactive elements work (`/mcp`, `/add-dir`, `/plugins`) | Feature wish. |
| 2   | Integrate Nimbalyst tracking system with Linear, JIRA, GitHub issues | Feature wish. |
| 1   | Collaboration on markdown across Nimbalyst users | Feature wish + we have replaced the collab path. |
| 369 | "Waiting for your response" status stays stuck after user replies | Real but minor UX bug; not blocking. Could be moved to Easy Wins if a quick repro is found. |
| 281 | iOS client repeatedly drops desktop connection mid-session on same local network | iOS-side connectivity issue — we ship desktop only and don't drive the mobile path. |

---

## Sanity check on totals

Unique issue counts: Already-fixed 0 + Critical 7 + Easy-wins 28 + Ignore 80 = 115. Matches `gh issue list` total.
