# Nimbalyst Source-Code Security Review

**Scope:** Electron main/renderer/preload source code, IPC surface, extension loading, local servers, deep links, secret handling, XSS sinks. Dependency supply-chain and network egress are out of scope (other agents).
**Date:** 2026-05-19  •  **Repo:** `/Users/west/projects/nimbalyst`  •  **Branch:** `main`

## Summary Verdict

Nimbalyst gets the **hard part right**: every `BrowserWindow` is created with `contextIsolation: true`, `nodeIntegration: false`, `webviewTag: false`, and default `webSecurity: true` — so an isolated XSS does not directly become RCE in the renderer. Secret handling for AI provider keys is disciplined (`getApiKeyForProvider` has no `process.env` fallback, voice-mode keys never leave the main process), the internal MCP HTTP servers are 127.0.0.1-bound with a per-launch bearer token, and `electron-updater` uses the standard signed GitHub feed.

However, the security model has a **soft middle**. The preload exposes a fully generic `invoke/send/on` passthrough, so the renderer is effectively trusted to call any IPC channel; several of those channels (`read-file-content`, `save-file`, the extension installers) accept arbitrary absolute paths or URLs with no workspace confinement, no allowlist, and — for extension installs — no signature verification and no zip-slip / path-traversal guard on the extension ID. The single `dangerouslySetInnerHTML` site renders `marked` output without DOMPurify, the renderer has **no Content-Security-Policy**, there are **no `setWindowOpenHandler` / `will-navigate` guards** on any window, the `renderer:eval` arbitrary-code-execution channel is wired up in all builds despite being labelled "dev mode only", and the unauthenticated `/clip` HTTP endpoint lets any web page plant files into the user's workspace. None of these is a one-click remote RCE on its own, but together they make any renderer-side content-injection bug (malicious markdown, a compromised extension, a hostile file opened from disk) far more damaging than it should be. Recommended hardening below is concrete and shippable.

---

## High-Severity Findings

### H1. Generic IPC passthrough + unconfined `read-file-content` = arbitrary file read from the renderer

**Files:**
- `packages/electron/src/preload/index.ts:1333-1335` — generic `invoke`/`send`/`on`
- `packages/electron/src/main/ipc/WorkspaceHandlers.ts:257-316` — `read-file-content` handler

The preload exposes:

```js
invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
send:   (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
on:     (channel: string, callback) => { ipcRenderer.on(channel, ...) }
```

This is a generic passthrough — the renderer can invoke **any** registered IPC channel, not a typed allowlist. The named methods above it (`readFileContent`, etc.) are therefore cosmetic; `window.electronAPI.invoke('read-file-content', '/Users/victim/.ssh/id_rsa')` works just as well.

`read-file-content` itself does **no validation**: it accepts any string `filePath`, checks only `existsSync`, and `readFileSync`s it (text or base64). There is no `SafePathValidator`, no workspace-prefix check, no blocked-extension check. `SafePathValidator` exists but is only wired into `ElectronFileSystemService` (the AI-tool layer) — **not** the IPC file handlers (`read-file-content`, `save-file`, `create-file`, `delete-file`, `move-file` in `WorkspaceHandlers.ts` / `FileHandlers.ts`).

**Exploit scenario:** Any content-injection bug in the renderer (see H3 — unsanitized markdown; or a malicious extension, see H2) gains the ability to read `~/.ssh/id_rsa`, `~/.aws/credentials`, browser cookie DBs, `.env` files, and the plaintext `app-settings.json` containing every API key (M1), then exfiltrate them via `fetch()` to an attacker host. The contextIsolation baseline does not help here — the attacker is using the legitimate exposed API.

**Fix direction:** Remove the generic `invoke/send/on` from the preload (or restrict `channel` to a hard-coded allowlist `Set`). Add `SafePathValidator`-style workspace confinement to every file IPC handler — resolve the path, require it to be inside a registered workspace root (using `path.relative` + `!startsWith('..')`, not raw `startsWith`), and reject blocked extensions/dotfiles. Treat the renderer as a partially-untrusted boundary.

### H2. Extension install has no signature verification, no manifest-ID validation (path traversal), and no zip-slip guard

**File:** `packages/electron/src/main/ipc/ExtensionMarketplaceHandlers.ts`

Three compounding problems in the extension install path:

1. **No signature/authenticity verification.** `installFromUrl` (line 243) only checks a SHA-256 `checksum` that is *itself supplied by the caller* (line 631: `safeHandle('extension-marketplace:install', (_event, extensionId, downloadUrl, checksum, version) => ...)`). And `verifyChecksum` returns `true` when `expectedChecksum` is empty (line 222). `installFromGitHub` (line 337) has no integrity check at all. There is no code signing, no publisher key, no TUF-style metadata signing.

2. **Extension ID path traversal.** `installFromUrl` does `path.join(extensionsDir, extensionId)` (line 250) and `installFromGitHub` does `path.join(extensionsDir, manifest.id)` (line 385) — `extensionId` comes from the deep link / renderer / cloned `manifest.json` with no validation that it is a safe single path segment. A value like `../../../../Library/LaunchAgents/x` escapes the extensions directory. Worse: the failure path does `fs.rm(installPath, { recursive: true, force: true })` (lines 275, 288, 391, 422) — a crafted ID turns "install" into **recursive delete of an arbitrary directory**.

3. **No zip-slip protection.** `extractNimext` (line 235) calls `extractZip(nimextPath, { dir: destPath })` with no entry-path sanitization. A `.nimext` with entries like `../../../foo` can write outside `installPath` depending on the `extract-zip` version's behavior.

Extensions also run with **full renderer privileges** — `loadExtensionFromPath` (`registerExtensionSystem.ts:116`) dynamically imports the extension's `main` bundle into the renderer via `es-module-shims` (`index.html:11`). There is no sandbox, no permission enforcement at runtime (the manifest `permissions[]` array is declarative only), so an installed extension can call every exposed `electronAPI` method including the generic `invoke` (H1).

**Exploit scenario:** A `nimbalyst://install/<id>` deep link, or a marketplace registry compromise, or a user pasting a hostile GitHub URL, results in attacker-controlled JS running in the renderer with full IPC access — and via H1, full local file read. The path-traversal variant additionally allows writing/deleting files anywhere the user can.

**Fix direction:** Validate `extensionId` / `manifest.id` against a strict regex (`^[a-z0-9][a-z0-9._-]*$`, reject `..`, `/`, `\`) before any `path.join`. Sanitize zip entry paths during extraction (reject entries that resolve outside `destPath`). Require a real signature (publisher public key embedded in the app, signed manifest) — caller-supplied SHA-256 is not authenticity. Consider running extension code in a sandboxed iframe / separate context with a brokered, permission-checked API surface rather than the full `electronAPI`.

### H3. `marked` output rendered via `dangerouslySetInnerHTML` with no DOMPurify

**File:** `packages/electron/src/renderer/components/UpdateToast/ReleaseNotesDialog.tsx:51-60, 112`

```js
const renderedReleaseNotes = marked.parse(releaseNotes) as string;
...
<div dangerouslySetInnerHTML={{ __html: renderedReleaseNotes }} />
```

`marked` does **not** sanitize HTML — raw `<script>`, `<img onerror=...>`, `<iframe>` etc. in the input pass through to the DOM. `releaseNotes` is `info.releaseNotes` from the `electron-updater` `update-available` event, i.e. the body of a GitHub release. Because the renderer has **no CSP** (M2), injected inline script would execute, and with the generic IPC passthrough (H1) that script reaches the full local-file API.

This is the only `dangerouslySetInnerHTML` in the renderer (good — the AI transcript markdown is rendered through a safer path), which limits blast radius, but the sink is real.

**Exploit scenario:** An attacker who can influence GitHub release notes (compromised maintainer account, malicious PR merged into release tooling) or who can MITM the update metadata feed delivers HTML+JS that executes in the renderer when the update toast/dialog renders.

**Fix direction:** Run `marked` output through `DOMPurify.sanitize()` before `dangerouslySetInnerHTML` (DOMPurify is already a dependency, used in `WorkspaceSidebar.tsx` etc.). Better: render release notes with a sanitizing React markdown component instead of raw HTML injection. Combine with a real CSP (M2) for defense in depth.

### H4. `renderer:eval` arbitrary-code-execution channel is active in production builds

**Files:**
- `packages/electron/src/renderer/plugins/registerExtensionSystem.ts:448-495` — listener
- `registerExtensionSystem.ts:686-687` — call site
- `packages/electron/src/main/mcp/extensionDevServer.ts:2248` — sender

`setupRendererEvalListener()` registers an IPC listener on `renderer:eval` that `eval()`s an attacker-controllable `expression` string in the renderer context. The function header comment says "Only active in development mode" and the call site comment says "(dev mode only)", but **there is no `process.env.NODE_ENV` / `app.isPackaged` guard** anywhere — neither inside `setupRendererEvalListener` nor at the `registerExtensionSystem.ts:687` call site. The channel is live in every build.

The main-process *sender* (`extensionDevServer.ts:2248`) is gated by an `isDev` check (line 2151), and the extension dev server binds to 127.0.0.1, so the *intended* trigger path is dev-only. But the renderer-side listener is unconditional, so anything able to deliver a `renderer:eval` IPC message (a malicious extension via the generic `invoke`/`send` passthrough — H1/H2 — or any future IPC-reachable path) gets full arbitrary JS execution in the renderer.

**Fix direction:** Wrap both `setupRendererEvalListener()` (call site) and the listener body in an explicit `if (process.env.NODE_ENV !== 'production' && !isPackaged)` guard so the channel does not exist in shipped builds. Treat eval-of-IPC-payload as dev-only infrastructure that must be compiled out, not merely "intended" to be unused.

---

## Medium-Severity Findings

### M1. API keys stored in plaintext JSON (electron-store, no encryption)

**File:** `packages/electron/src/main/utils/store.ts:463-497`

`getAppStore()` constructs `new Store({ name: 'app-settings', ... })` with **no `encryptionKey`** option. The `apiKeys` object (Anthropic, OpenAI, OpenAI-Codex, Claude Code keys) is therefore written as cleartext to `~/Library/Application Support/@nimbalyst/electron/app-settings.json` (mode 0644 by default).

electron-store's `encryptionKey` is only obfuscation (the key ships in the binary), but plaintext means the keys are trivially harvested by: any other process running as the user, Time Machine / cloud backups, log scrapers, and — combined with H1 — a renderer-side injection reading the file directly. The project's own CLAUDE.md treats accidental key usage as a $100+ incident; at-rest exposure deserves equal weight.

**Fix direction:** Store provider API keys via the OS keychain (`safeStorage.encryptString` / `keytar`-style) rather than electron-store JSON. At minimum, set restrictive file permissions (0600) on `app-settings.json` and document the exposure. Prefer the OAuth/login auth methods over raw API keys where possible.

### M2. Renderer has no Content-Security-Policy

**File:** `packages/electron/src/renderer/index.html` (no CSP meta tag); no `onHeadersReceived` CSP in `index.ts`

The main renderer `index.html` ships **without any CSP** — no `<meta http-equiv="Content-Security-Policy">` and no `session.defaultSession.webRequest.onHeadersReceived` injecting one. (Note: `src/renderer/history.html:7` *does* have a strict CSP — proving the team knows the pattern, just not applied to the main window.)

With no CSP: any HTML/JS injection (H3, a compromised extension, a hostile rendered file) executes inline scripts freely and can `connect-src` to any host for exfiltration. `unsafe-eval` is effectively in play anyway because `es-module-shims` runs in `shimMode` for extension import maps, which complicates a strict policy — but a CSP restricting `connect-src`, `object-src 'none'`, `frame-src`, and `default-src` would still meaningfully contain exfiltration and plugin/object abuse.

**Fix direction:** Add a CSP to `index.html` (or via `onHeadersReceived`) with at least `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-src 'none'` (or an allowlist), and a tight `connect-src` allowlisting only the sync/marketplace/API hosts the app legitimately calls. Audit whether `es-module-shims` truly needs `unsafe-eval`; if so, scope it as narrowly as possible and compensate with `connect-src`.

### M3. No `setWindowOpenHandler` / `will-navigate` guards on any window

**Files:** all of `packages/electron/src/main/window/*.ts` and `WindowManager.ts` (verified absent via grep)

No `BrowserWindow` / `webContents` in the codebase registers `setWindowOpenHandler` or a `will-navigate` listener. Electron best practice (and the official security checklist) is to deny or tightly control window-open and navigation so that injected content cannot navigate the trusted renderer to an attacker origin or spawn arbitrary child windows (which could inherit the preload).

In dev mode the renderer loads from `http://localhost:5273`; if injected content triggers a navigation to a remote origin, that remote page would run inside a window that still has the Nimbalyst preload attached.

**Fix direction:** On every window's `webContents`, add `setWindowOpenHandler(() => ({ action: 'deny' }))` (route external links through `shell.openExternal` explicitly) and a `will-navigate` handler that calls `event.preventDefault()` for any URL outside the expected app origin / dev-server origin.

### M4. Unauthenticated `/clip` HTTP endpoint lets any web page write files into the workspace

**File:** `packages/electron/src/main/mcp/httpServer.ts:511-535, 820-894`

The internal MCP HTTP server (127.0.0.1) gates `/mcp` behind the per-launch bearer token, but `/clip` is **intentionally left unauthenticated** with `Access-Control-Allow-Origin: *` (lines 516-521, 822) so the browser web-clipper extension can POST to it. A `POST /clip` with `{content, title, url}` causes `fs.writeFileSync` of a markdown file into `<workspace>/nimbalyst-local/clips/` (lines 871-894).

Because the endpoint is CORS-open and tokenless, **any web page the user visits** can `fetch('http://127.0.0.1:<port>/clip', {method:'POST', body: ...})` and silently plant attacker-controlled markdown into the currently-focused workspace. The filename is sanitized; the *content* is not. Planted files become input to AI agents (prompt-injection vector) and to the editor. The frontmatter builder also interpolates `body.url` into a double-quoted YAML string with no escaping (line 879) — a crafted `url` can break YAML / inject extra frontmatter keys.

**Fix direction:** Require the bearer token on `/clip` too, and have the web-clipper extension obtain the token (it already runs as a first-party Nimbalyst extension). If tokenless operation is a hard requirement, at minimum verify the `Origin` header against an allowlist, drop the `Access-Control-Allow-Origin: *`, and surface a user confirmation before writing. Escape `body.url` / `body.title` for YAML.

### M5. AppleScript command construction for external terminal editors

**File:** `packages/electron/src/main/ipc/WorkspaceHandlers.ts:1067-1078` (`open-in-external-editor`)

For `vim`/`nvim` on macOS, the handler builds an AppleScript `do script` string and runs it via `spawn('osascript', ['-e', script])`:

```js
const escapedPath = filePath.replace(/'/g, "'\\''");
const script = `tell application "Terminal" ... do script "${command} '${escapedPath}'" ... end tell`;
```

`escapedPath` only escapes single quotes for the *shell* layer, but it is then embedded inside an AppleScript **double-quoted** string. A `filePath` containing a double-quote (or backslash) breaks out of the AppleScript string literal — and `do script` hands its argument to the shell, so this is a shell-command-injection primitive. `filePath` originates from the renderer via the generic IPC passthrough (H1), and for the `custom` editor type the `command` is a user-configured path that is also not escaped. File paths with `"` are legal on macOS.

`spawn('osascript', ['-e', ...])` (no `shell: true`) is correct for the argv layer; the bug is the string interpolation *into* the AppleScript program.

**Fix direction:** Do not build AppleScript by string concatenation from a path. Pass the path as an AppleScript argument / use `osascript`'s ability to read arguments (`on run argv`), or properly escape for AppleScript string literals (`\` and `"`). Validate that `filePath` resolves inside a known workspace before launching anything.

---

## Low-Severity / Informational

### L1. Deep-link extension install relies on renderer-side confirmation only

`handleDeepLink` (`index.ts:706-717`) maps `nimbalyst://install/<id>` to `queueMarketplaceInstallRequest`, which only *sends an IPC event* to renderers (`ExtensionMarketplaceHandlers.ts:560-571`) — it does not install directly. Whether the user gets a confirmation prompt depends entirely on the renderer's `extension-marketplace:install-request` listener. The main process should not assume the renderer will prompt; the actual `extension-marketplace:install` handler (which *does* perform the install) should itself require explicit, main-process-verified user consent for any deep-link-originated install. (Combine with H2's missing signature verification.)

### L2. `permissionRequestHandler` allows all non-media permissions

`index.ts:945-973` — `setPermissionRequestHandler` carefully gates microphone but ends with `callback(true)` for everything else (geolocation, notifications, clipboard-read, etc.). For a desktop app this is mostly acceptable, but an explicit allowlist (`notifications`, `clipboard-sanitized-write`, deny the rest) is the hardening posture and pairs well with M3.

### L3. Console-message capture sends all renderer logs to `ExtensionLogService` unconditionally

`WindowManager.ts:339-360` forwards every renderer `console-message` to `ExtensionLogService` (for agent debugging) in all builds; only the *file* logging is dev-gated. If extension/renderer logs ever contain secrets, those logs become reachable by AI agents via the extension log tooling. Low risk, worth a note.

### L4. `git` operations use `spawn('git', [args])` with argv arrays — generally safe

`ExtensionMarketplaceHandlers.ts:execGit`, `ClaudeCodePluginHandlers.ts:348`, `GitStatusService.ts`, etc. mostly use `spawn`/`execFile` with argument arrays (no shell), which avoids classic injection. One exception worth confirming: `GitStatusService.ts:631` builds `git diff --name-only ${mainBranch}...${worktreeBranch}` via `execSync` with **string interpolation** of branch names — if branch names are ever attacker-influenced, an argument-injection (`--output=...`) or refspec-trick is possible. Branch names here appear to be locally derived, so this is informational, but switching to `execFile('git', ['diff','--name-only',`${a}...${b}`])` removes the doubt.

### L5. `ClaudeCodeHandlers.ts` uses `spawn(..., { shell: true })` with an interpolated binary path

`ClaudeCodeHandlers.ts:131,134,197` build Windows `cmd /c start ...` strings with `shell: true` and interpolate `binaryPath`. `binaryPath` is internally resolved (CLI detector), not renderer-supplied, so risk is low — but `shell: true` + interpolation is a fragile pattern; prefer argv arrays.

---

## Verified Clean

- **BrowserWindow security baseline (main editor windows):** `WindowManager.ts:245-258` sets `nodeIntegration: false`, `contextIsolation: true`, `webviewTag: false`, and deliberately leaves `webSecurity` at its secure default `true` (with a documented rationale referencing issue #146 and the `nim-asset://` scheme migration). `allowRunningInsecureContent`, `enableRemoteModule`, `nodeIntegrationInSubFrames` are not enabled anywhere.
- **All auxiliary windows** (`AboutWindow`, `DatabaseBrowserWindow`, `DeveloperDashboardWindow`, `SplashScreen`, `WorkspaceManagerWindow`, `AIUsageReportWindow`) set `contextIsolation: true` + `nodeIntegration: false` (default). `AIUsageReportWindow` explicitly sets `sandbox: false` but keeps `contextIsolation: true` — acceptable since it needs the preload.
- **API key handling — no `process.env` fallback:** `AIService.getApiKeyForProvider` (`AIService.ts:451-491`) returns keys only from the electron-store `apiKeys` object and project-level overrides, with an explicit comment documenting the prior $100+ incident. `claude-code` returns `undefined` unless API-key auth is explicitly selected. `sdkOptionsBuilder.ts:253` actively *strips* `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` from the env passed to SDK subprocesses.
- **Voice mode key flow:** the OpenAI Realtime key is read from the settings store in the **main process** (`VoiceModeService.ts:269-270`), and the `wss://api.openai.com/v1/realtime` WebSocket with `Authorization: Bearer` is opened by `RealtimeAPIClient` in the main process (`RealtimeAPIClient.ts:275-281`). The key is never sent to the renderer; audio crosses the IPC boundary, not credentials.
- **Internal MCP HTTP servers** (`httpServer.ts`, `extensionDevServer.ts`, etc.) bind to `127.0.0.1` only (`httpServer.ts:909`, `extensionDevServer.ts:3017`) and gate `/mcp` behind a 256-bit per-launch random bearer token (`mcpAuth.ts`) compared with `crypto.timingSafeEqual`. The token is generated in memory at startup and never persisted.
- **`extensionDevServer` eval tool** (`extension_test_eval`) is correctly gated behind an `isDev` check (`extensionDevServer.ts:2151-2154`) on the *sender* side. (The renderer *listener* gating is the H4 gap.)
- **`electron-updater`** uses the standard `provider: 'github'` feed (`autoUpdater.ts:25-29`) with `autoDownload: false`; electron-updater performs its own signature/hash verification of release artifacts. Update install correctly closes the DB and saves session state before `quitAndInstall`.
- **`SafePathValidator`** (`security/SafePathValidator.ts`) is a solid path-traversal defense (blocks `..`, absolute paths, UNC, null bytes, shell metacharacters, forbidden dirs like `.ssh`/`.aws`, blocked extensions) — it is correctly applied in `ElectronFileSystemService` (the AI-tool file layer). The finding in H1 is that it is *not* applied to the renderer IPC handlers, not that the validator is weak. (One nit: its post-resolve check uses `fullPath.startsWith(resolvedWorkspace)` — prefer `path.relative` to avoid sibling-prefix bypass like `proj` vs `proj-evil`.)
- **`safeHandle`/`safeOn`** (`ipcRegistry.ts`) are duplicate-registration guards only — they do not (and are not meant to) validate payloads; per-handler validation is the right place and many handlers (e.g. marketplace handlers checking `extensionId`/`githubUrl` presence, `httpServer` query-param type checks) do validate presence/type, though not always semantics.
- **Single-instance lock + deep-link routing** (`index.ts:498-588`) correctly funnels `nimbalyst://` URLs and file args through `requestSingleInstanceLock`/`second-instance`/`open-url`; the auth-callback branch requires `org_id` and `session_token` before processing.
- **XSS surface is small:** exactly one `dangerouslySetInnerHTML` in the entire renderer (H3); the AI transcript and general markdown rendering do not use raw HTML injection. `DOMPurify` is a project dependency and is used elsewhere.
- **`webviewTag: false`** on every window — no `<webview>` attack surface.
