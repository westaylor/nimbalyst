# Nimbalyst Security Review — Executive Summary

**Product:** Nimbalyst desktop application (Electron) — [Nimbalyst/nimbalyst](https://github.com/Nimbalyst/nimbalyst)
**Commit reviewed:** `7ff12751` (monorepo `0.33.1`, `@nimbalyst/electron` `0.60.4`)
**Reviewer:** Internal pre-release security review for a signed macOS distribution build.
**Date:** 2026-05-19
**Vendor / signer:** WijMir LLC (`Developer ID Application: WijMir LLC (AZX236YXRK)`)

This is the top-level summary. Detailed findings live in three appendix reports:

- [01-source-code-review.md](./01-source-code-review.md) — Electron window baseline, preload/IPC surface, CSP, deep links, extension loading, secret handling, XSS sinks, local HTTP servers.
- [02-supply-chain-audit.md](./02-supply-chain-audit.md) — CVE triage, lockfile hygiene, install lifecycle scripts, dependency overrides, bundled binaries.
- [03-network-egress-audit.md](./03-network-egress-audit.md) — every outbound endpoint, telemetry/consent model, AI provider hosts, auto-update, sync/auth, firewall allowlist.

A fourth document, [04-build-and-release.md](./04-build-and-release.md), records the signed-build procedure used for this review.

---

## Verdict

**Nimbalyst is in good shape and is shippable as a signed build.** It gets the hard, expensive parts of Electron security right: every `BrowserWindow` runs with `contextIsolation: true`, `nodeIntegration: false`, `webviewTag: false`, and the secure `webSecurity` default — so an isolated XSS does not automatically become renderer RCE. AI provider secret handling is disciplined (no `process.env` key fallback, voice-mode keys never leave the main process), the internal MCP HTTP servers are `127.0.0.1`-bound behind a per-launch bearer token, `electron-updater` uses the standard signed GitHub feed, and the dependency lockfile is clean (every resolution HTTPS + sha512, no git sources, no suspicious install hooks).

**There are zero critical CVEs and zero exploitable CVEs in the shipped application.** The remaining `npm audit` advisories are either build-time toolchain noise that never reaches a user's machine, or transitive chains whose vulnerable code path is not reachable with attacker-controlled input in Nimbalyst's usage (see Supply Chain TL;DR).

The real findings are not in the dependency tree or the network layer — they are in the **renderer trust boundary**. The preload exposes a fully generic `invoke/send/on` IPC passthrough, so the renderer can call any channel; several of those channels (`read-file-content`, the extension installers, the `/clip` HTTP endpoint) accept arbitrary paths or content with no confinement, no allowlist, and — for extension installs — no signature verification. None of these is a one-click remote RCE on its own, but together they mean any renderer-side content-injection bug is far more damaging than it should be. All of it is patchable without architectural surgery; the hardening checklist below is concrete and prioritized.

One non-code finding worth a product decision: **PostHog analytics defaults to ON with no first-run consent prompt, and the consent check fails open** (see Network Egress TL;DR).

---

## Dependency Remediation Performed

As part of this review, the following dependency bumps were applied and the lockfile regenerated (`npm install`). The `peer: true` flag count in `package-lock.json` was verified to remain at **18** (the root `CLAUDE.md` warns these can be stripped).

| Package | From | To | Clears |
|---|---|---|---|
| `electron` (devDep + `build.electronVersion`) | `41.0.4` | `41.6.1` | 3 moderate Chromium/IPC advisories (use-after-free, clipboard crash, `window.open` scoping) |
| `mermaid` (electron + runtime) | `^11.12.0` | `^11.15.0` | Gantt-chart infinite-loop DoS, `classDef` CSS/HTML injection |
| `ws` (electron) | `^8.19.0` | `^8.20.1` | Uninitialized memory disclosure |
| `express-rate-limit` (electron) | `^7.5.1` | `^8.5.2` | Converges with root `8.x`, dedupes the `ip-address` chain |
| `posthog-js` (electron + runtime) | `^1.280.1` | `^1.374.2` | General currency |
| `elliptic` (new root `overrides` entry) | `6.6.x` | `^6.6.1` | Risky-cryptographic-primitive advisory |

**Post-bump state:** production dependency tree (`npm audit --omit=dev`) reports **0 critical, 0 exploitable**. Remaining advisories are triaged in [02-supply-chain-audit.md](./02-supply-chain-audit.md) — see "Deferred / Accepted" below.

**Deliberately deferred** (breaking majors — not release blockers, not exploitable today):

- `electron-store` `8.x → 10.x` — clears 6 of the remaining "high" advisories (the `conf → ajv → fast-uri` chain) but is a breaking ESM-only major that **requires re-deriving the `build.files` allowlist** in `packages/electron/package.json`. The `fast-uri` path-traversal advisory is not exploitable here (Nimbalyst only resolves trusted internal JSON schemas, never attacker-supplied URIs).
- `@anthropic-ai/sdk` `0.81 → 0.97` — clears a *moderate* (insecure default file permissions on the Claude memory tool). The jump spans 16 minor releases of a pre-1.0 SDK with real API churn, and the SDK is version-coupled to the `@anthropic-ai/claude-agent-sdk@0.2.126` `overrides` pin. Bump and regression-test Claude streaming + tool use as a dedicated task, not inline with the release.
- `uuid` `11 → 14` — a *moderate* buffer-bounds advisory that is **not reachable** (Nimbalyst never passes the `buf` argument). Hygiene-only.

---

## Source-Code Findings — TL;DR

Four High-severity findings, five Medium, five Low. Full bodies with `file:line` citations and fix direction in [01-source-code-review.md](./01-source-code-review.md). Headlines:

| ID | Title | Reference |
|---|---|---|
| **H1** | Preload exposes a generic `invoke/send/on` passthrough — the renderer can call any IPC channel. Combined with `read-file-content` accepting arbitrary absolute paths (no `SafePathValidator`, no workspace confinement), any renderer injection can read `~/.ssh`, `~/.aws/credentials`, `.env`, and the plaintext key store. | [preload/index.ts:1333](../packages/electron/src/preload/index.ts), [WorkspaceHandlers.ts:257](../packages/electron/src/main/ipc/WorkspaceHandlers.ts) |
| **H2** | Extension install has no signature verification (caller-supplied SHA-256 only; empty checksum passes), no validation of `extensionId`/`manifest.id` before `path.join` (path traversal → arbitrary write, and the failure path `fs.rm` turns it into arbitrary recursive delete), and no zip-slip guard. Extensions run with full renderer/IPC privileges. | [ExtensionMarketplaceHandlers.ts](../packages/electron/src/main/ipc/ExtensionMarketplaceHandlers.ts) |
| **H3** | `marked` output rendered via `dangerouslySetInnerHTML` with no DOMPurify; input is GitHub release-notes HTML. With no CSP (M2) and the IPC passthrough (H1), injected script reaches the local-file API. | [ReleaseNotesDialog.tsx:112](../packages/electron/src/renderer/components/UpdateToast/ReleaseNotesDialog.tsx) |
| **H4** | `renderer:eval` arbitrary-code-execution IPC channel is wired up unconditionally despite a "dev mode only" label — no `NODE_ENV`/`isPackaged` guard on the listener. | [registerExtensionSystem.ts:448](../packages/electron/src/renderer/plugins/registerExtensionSystem.ts) |

Medium: **M1** API keys stored as plaintext JSON in electron-store (no `encryptionKey`, no keychain); **M2** main renderer has no Content-Security-Policy (history.html proves the team knows the pattern); **M3** no `setWindowOpenHandler`/`will-navigate` guards on any window; **M4** the unauthenticated, CORS-open `/clip` HTTP endpoint lets any web page plant files into the workspace (prompt-injection vector for AI agents); **M5** AppleScript command construction in `open-in-external-editor` interpolates a file path into a double-quoted AppleScript string.

**Verified clean:** the full window security baseline, no `process.env` API-key fallback, voice-mode key isolation, MCP bearer-token auth with `timingSafeEqual`, `electron-updater` signed feed, `SafePathValidator` correctness (it is just not wired into the renderer IPC handlers), `webviewTag: false` everywhere, exactly one `dangerouslySetInnerHTML` in the renderer.

---

## Supply Chain — TL;DR

| Category | Verdict |
|---|---|
| Lockfile (`package-lock.json`, v3) | **Clean.** All 1945+ resolutions HTTPS `registry.npmjs.org` with sha512 integrity; no `http://`, no git/GitHub sources; 18 `peer: true` flags intact. |
| Critical CVEs | **0.** |
| Exploitable CVEs in shipped app | **0** after the bumps above — every remaining advisory is build-time-only or a non-reachable transitive path. |
| `npm install` lifecycle hooks | **Clean.** Only repo-authored hook is `electron-builder install-app-deps` in `packages/electron`. The 21 third-party install scripts are all standard native-build / binary-fetch packages (`@vscode/ripgrep`, `node-pty`, `electron`, `esbuild`, `sharp`, …) from npmjs.org. No suspicious third-party hook. |
| `overrides` block | **Defensible.** `prismjs` is a security floor (keep); `vite`/`zod` are de-duplication; `@anthropic-ai/claude-agent-sdk` exact-pin is correct for a binary-coupled package. `zod@4` forced onto transitive consumers deserves a functional spot-check with the MCP SDK. |
| Bundled binaries | **Acceptable.** AI-CLI binaries (`@openai/codex`, `@zed-industries/codex-acp`, `@anthropic-ai/claude-agent-sdk-*`) ship prebuilt *inside* the npm tarball — fully covered by lockfile integrity. `@vscode/ripgrep` and `electron` do install-time CDN downloads but verify their own checksums. |

**Deferred / Accepted advisories** (full reasoning in report 02): the `posthog-js → @opentelemetry → protobufjs` chain (Nimbalyst only *encodes* outbound analytics protobufs, never *decodes* attacker bytes); `fast-uri`/`ajv` path traversal (trusted internal schemas only); `lodash-es` prototype pollution (paths not attacker-controlled); `dompurify` inside `monaco-editor` (do **not** force-override — Monaco pins it deliberately; instead audit whether Monaco hover/markdown ever renders untrusted HTML); `jimp`/`file-type` ASF DoS (self-inflicted on a locally-opened image).

---

## Network Egress — TL;DR

**Telemetry, crash reporting:** PostHog only — no Sentry / Mixpanel / Amplitude / Segment / Datadog / Bugsnag, no Google Analytics, `crashReporter` not initialized.

**Privacy-relevant finding — analytics consent:** PostHog telemetry **defaults to ON** with **no first-run consent prompt**; the only control is a toggle buried in Settings → Advanced. The consent check `allowedToSendAnalytics()` **fails open** — it returns `true` on any store-read error. There is also a docs-vs-code discrepancy: `docs/ANALYTICS_GUIDE.md` claims opted-out users still send a retention ping, but the code does not do this (the early-return path is correct). **Recommend** a first-run consent prompt (or at minimum a clear privacy notice), and changing the fail-open default to fail-closed. PostHog project key `phc_s3lQ…` with no `api_host` override → US cloud, `disableGeoip: false`.

**Always-on runtime egress** (fires even with analytics off, sync off, no AI use):

- `fonts.googleapis.com` / `fonts.gstatic.com` — Material Symbols font, `@import` in `index.css`, every launch. Consider self-hosting the font to remove this.
- `cdn.simpleicons.org` — vendor icons when MCP/plugin settings panels open.
- `github.com` — auto-update check, fires ~30s after launch then hourly in packaged builds; **no user-facing disable setting**.

**Opt-in / user-initiated only:** AI providers (Anthropic, OpenAI, OpenAI Realtime voice `wss://api.openai.com/v1/realtime`, LM Studio local); collaborative sync `wss://sync.nimbalyst.com` (connects only when sync is enabled); Stytch auth `api.stytch.com/v1/b2b` (public token only); extension marketplace `extensions.nimbalyst.com/registry`.

**Trust-boundary note:** extensions can be git-cloned from **any** `github.com/{owner}/{repo}` URL the user pastes — worth a UI warning (ties to H2). A firewall-ready domain allowlist table is at the top of [03-network-egress-audit.md](./03-network-egress-audit.md).

---

## Pre-Release Hardening Checklist (Prioritized)

This is the actionable deliverable. Each row is independent.

### Tier 1 — Before the next signed release (quick, high-leverage)

| # | Action | Source |
|---|---|---|
| 1 | **Replace the generic `invoke/send/on` preload passthrough** with a hard-coded channel allowlist `Set`, or remove it entirely in favor of the named typed methods. | 01 §H1 |
| 2 | **Wire `SafePathValidator` into the renderer file IPC handlers** (`read-file-content`, `save-file`, `create-file`, `delete-file`, `move-file`) — it already exists and is used in the AI-tool layer; it just isn't applied here. Use `path.relative` for the confinement check, not `startsWith`. | 01 §H1, Verified-Clean note |
| 3 | **Validate `extensionId` / `manifest.id`** against `^[a-z0-9][a-z0-9._-]*$` (reject `..`, `/`, `\`) before any `path.join`; add zip-entry-path sanitization to `extractNimext`; reject empty checksums. | 01 §H2 |
| 4 | **Gate `renderer:eval` out of production** — wrap both the call site and the listener body in `if (!app.isPackaged && NODE_ENV !== 'production')`. | 01 §H4 |
| 5 | **DOMPurify the release-notes sink** — `DOMPurify.sanitize(marked.parse(...))` before `dangerouslySetInnerHTML` (DOMPurify is already a dependency). | 01 §H3 |
| 6 | **Require the MCP bearer token on `/clip`** (or verify the `Origin` header against an allowlist and drop `Access-Control-Allow-Origin: *`); escape `body.url`/`body.title` for YAML frontmatter. | 01 §M4 |
| 7 | **Add a CSP to the main renderer** — `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, a tight `connect-src` allowlist. Audit whether `es-module-shims` truly needs `unsafe-eval`. | 01 §M2 |
| 8 | **Add `setWindowOpenHandler(() => ({action:'deny'}))` and a `will-navigate` guard** to every window's `webContents`. | 01 §M3 |
| 9 | **Decide the analytics consent model** — add a first-run consent prompt or clear privacy notice; change `allowedToSendAnalytics()` to fail closed. | 03 §Telemetry |

### Tier 2 — Next sprint (hardening)

| # | Action | Source |
|---|---|---|
| 10 | **Move provider API keys to the OS keychain** (`safeStorage.encryptString`), or at minimum `chmod 0600` `app-settings.json`. | 01 §M1 |
| 11 | **Fix the AppleScript injection** in `open-in-external-editor` — pass the path as an `on run argv` argument instead of string-interpolating it into a double-quoted AppleScript literal. | 01 §M5 |
| 12 | **Sign extensions** — embed a publisher public key, sign the manifest; caller-supplied SHA-256 is integrity, not authenticity. Add a UI warning when installing an extension from an arbitrary GitHub URL. | 01 §H2, 03 §Marketplace |
| 13 | **Bump `@anthropic-ai/sdk` to `^0.97`** and regression-test Claude streaming + tool use; verify the memory tool writes files `0600`. | 02 |
| 14 | **Bump `electron-store` to `10.x`** and re-derive the `build.files` allowlist; clears the remaining `conf → ajv → fast-uri` "high" chain. | 02 |
| 15 | **Self-host the Material Symbols font** to remove the always-on Google Fonts egress; add a user-facing toggle for the auto-update check. | 03 |

### Tier 3 — Longer-term

| # | Action | Source |
|---|---|---|
| 16 | **Sandbox the extension model** — run extension code in a brokered, permission-checked context rather than granting the full `electronAPI` (including the generic `invoke`). The manifest `permissions[]` array is currently declarative only. | 01 §H2 |
| 17 | **Per-handler IPC sender validation** — verify the sender frame URL on sensitive channels. | 01 §M3 follow-on |

---

## What We Did NOT Find (Verified Clean)

- **Electron window baseline is correct** — `contextIsolation: true`, `nodeIntegration: false`, `webviewTag: false`, secure `webSecurity` on every window.
- **No `process.env` API-key fallback** — `getApiKeyForProvider` reads only explicitly-configured keys; SDK subprocess env is actively stripped of `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`.
- **Voice-mode keys never reach the renderer** — the OpenAI Realtime socket is opened in the main process.
- **Internal MCP HTTP servers bind `127.0.0.1` only**, behind a 256-bit per-launch bearer token compared with `crypto.timingSafeEqual`.
- **`electron-updater`** uses the standard signed `github` provider feed with `autoDownload: false`.
- **Lockfile integrity** — every resolution HTTPS + sha512, no git sources, no plaintext registries.
- **No suspicious install hooks** across all workspace and third-party `package.json` files.
- **No Sentry/Mixpanel/Amplitude/Segment/Datadog/Bugsnag**, no Google Analytics, `crashReporter` not started.
- **Sync and AI providers are opt-in / user-initiated** — nothing connects to the sync server or an AI provider without explicit user action.
- **Exactly one `dangerouslySetInnerHTML`** in the renderer (H3) — the AI transcript markdown uses a safer path.
- **0 critical CVEs**, 0 exploitable CVEs in the shipped app.

---

## Limitations of This Review

- **Static review.** No dynamic analysis (no instrumented runtime, no live network capture). Findings are derived from source reading, `npm audit`, and the lockfile.
- **CVE snapshot is current as of 2026-05-19** via live `npm audit`. Advisory databases update continuously — re-run before each release.
- **`packages/collabv3`** (the Cloudflare Workers sync server) is not present in this checkout — only `collab-protocol` (shared types) was reviewable. The server-side sync/auth code was not audited.
- **Extension code paths** were reviewed for the loader and install flow, not for individual bundled extensions.
- **Threat model** assumes a desktop deployment where the realistic high-risk scenarios are renderer-side content injection (malicious markdown, a compromised/hostile extension, a hostile file opened from disk) and a supply-chain compromise of a dependency. Physical access and a fully-compromised host are out of scope.
