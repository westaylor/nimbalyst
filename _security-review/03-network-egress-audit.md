# Network Egress / Phone-Home Audit — Nimbalyst Desktop App

**Audit scope:** `packages/electron/src`, `packages/runtime/src`, `packages/collab-protocol`, `packages/extensions`
**Date:** 2026-05-19
**Status:** Defensive pre-release audit (authorized — WijMir LLC own product)

## Summary

Nimbalyst is an Electron AI workspace. Its runtime outbound traffic falls into five buckets: (1) **telemetry** to PostHog, (2) **AI provider APIs** (Anthropic, OpenAI, OpenAI Realtime voice, plus user-configurable LM Studio and Codex/Claude Code CLIs), (3) **auto-update** checks against GitHub Releases, (4) **collaboration/sync/auth** to first-party Cloudflare-hosted endpoints (`sync.nimbalyst.com`) and Stytch for authentication, and (5) the **extension marketplace** at `extensions.nimbalyst.com`.

Nothing exotic phones home — no Sentry/Mixpanel/Amplitude/Segment/Datadog/Bugsnag, no Google Analytics, and Electron's `crashReporter` is not wired up. However, **two privacy-relevant findings stand out:**

1. **Analytics consent defaults to ON.** `analyticsEnabled` defaults to `true` in both the app-settings store and the dedicated `analytics-settings` store. There is **no first-run consent prompt** — the only control is a buried "Send Anonymous Usage Data" toggle in Settings > Advanced. The PostHog renderer client initializes and fires events on the very first launch before any user interaction. The consent check also **fails open** (`allowedToSendAnalytics()` returns `true` on any error reading the store).

2. **A few always-on third-party CDN loads** run at startup regardless of analytics consent: Google Fonts (`fonts.googleapis.com` for the Material Symbols icon font, imported in `index.css`) and `cdn.simpleicons.org` (brand icons in MCP/plugin settings panels). These leak the user's IP to Google and the simpleicons CDN. Auto-update also runs unconditionally in packaged builds (no off switch) and contacts GitHub.

Everything else (sync, teams, AI providers, voice, sharing, marketplace install) is user-initiated or opt-in.

---

## Domain Allowlist Summary

All hosts a **packaged build can contact on an end-user's machine at runtime.** Build-time-only hosts are excluded (see separate section).

| Host | Purpose | When it fires | User-disableable? |
|---|---|---|---|
| `us.i.posthog.com` | PostHog analytics event ingestion (default host — no `api_host` override set) | App startup + on user actions | Yes — Settings > Advanced toggle. **BUT defaults ON, no consent prompt** |
| `us-assets.i.posthog.com` | PostHog JS SDK static assets / feature flags | App startup (renderer PostHog init) | Tied to same analytics toggle |
| `fonts.googleapis.com` | Google Fonts — Material Symbols icon font (`@import` in `index.css`) | App startup, every launch | No |
| `fonts.gstatic.com` | Google Fonts — actual font binary served by the above CSS | App startup, every launch | No |
| `cdn.simpleicons.org` | Brand/vendor icons in MCP Servers & Claude Code Plugins settings panels | When those settings panels are opened | No |
| `github.com` / `objects.githubusercontent.com` (API + release assets for repo `nimbalyst/nimbalyst`) | `electron-updater` auto-update feed + binary download | 30s after launch, then every 60 min (packaged builds only) | No — no setting to disable; only in packaged builds |
| `api.anthropic.com` | Claude (Anthropic) chat/agent provider API | User sends an AI message to a Claude provider | Only by not configuring/using Claude |
| `api.openai.com` | OpenAI chat provider + OpenAI TTS voice preview (`/v1/audio/speech`) | User sends OpenAI message / previews a voice | Only by not configuring/using OpenAI |
| `api.openai.com` (`wss://api.openai.com/v1/realtime`) | OpenAI Realtime voice mode WebSocket | User starts Voice Mode | Voice Mode is opt-in |
| `sync.nimbalyst.com` (`wss://` sync + `https://` share API) | First-party collaboration/sync server + document/session sharing API | Only when sync enabled / a doc is shared | Yes — sync is opt-in (`config.enabled`); sharing is per-action |
| `api.stytch.com` (`/v1/b2b`) | Stytch authentication (sign-in for sync/teams) | User signs in to sync/teams | Yes — only when user initiates sign-in |
| `extensions.nimbalyst.com` (`/registry`) | Extension marketplace registry listing | When user opens the Extension Marketplace panel | Yes — only on user action |
| `raw.githubusercontent.com` (`anthropics/claude-plugins-official`) | Claude Code official plugin marketplace manifest | When user opens Claude Code Plugins panel | Yes — only on user action |
| `github.com` (arbitrary `{owner}/{repo}`) | Git-clone of extensions installed from a user-pasted GitHub URL | When user installs an extension by GitHub URL | Yes — explicit user action |
| Arbitrary marketplace `downloadUrl` hosts | `.nimext` extension package download | When user installs a marketplace extension | Yes — explicit user action |
| Arbitrary host (LM Studio base URL, default `http://127.0.0.1:8234`) | Local LLM provider | User uses LM Studio provider | Local by default; user-configurable URL |
| Arbitrary MCP server URLs | User-configured remote MCP servers (Zapier, Notion, Linear, etc.) | When user adds/enables a remote MCP server | Yes — fully user-configured |
| ChatGPT / OpenAI OAuth + Anthropic (via Codex CLI / Claude Code SDK) | Codex and Claude Code agent providers manage their own auth + API endpoints | User uses Codex / Claude Code agent | Only by not using those agents |

> **Firewall note:** A minimal install that disables analytics, never enables sync, never uses cloud AI providers, and never opens the marketplace will still contact `fonts.googleapis.com` / `fonts.gstatic.com`, `cdn.simpleicons.org` (if the relevant settings panels are visited), and `github.com` (auto-update). Those three are the unavoidable always-on egress in a packaged build.

---

## Telemetry & Analytics

**Vendor:** PostHog only. No Sentry, Mixpanel, Amplitude, Segment, Datadog, Bugsnag, Google Analytics/gtag. Electron `crashReporter` is **not** initialized anywhere. (`sentry` and `posthog` appear elsewhere only as *MCP server options* a user can add — not telemetry.)

### PostHog configuration

| Item | Value | Location |
|---|---|---|
| Project public key | `phc_s3lQIILexwlGHvxrMBqti355xUgkRocjMXW4LjV0ATw` | `packages/electron/src/renderer/index.tsx:197` and `packages/electron/src/main/services/analytics/AnalyticsService.ts:9` |
| API host | **Not set** — defaults to PostHog US cloud (`us.i.posthog.com`) | No `api_host` config present anywhere in `packages/electron/src` |
| Renderer client | `posthog-js`, initialized at module load in `index.tsx` | `packages/electron/src/renderer/index.tsx:196-221` |
| Main-process client | `posthog-node`, singleton `AnalyticsService` | `packages/electron/src/main/services/analytics/AnalyticsService.ts:21-261` |

Renderer init hardening (`index.tsx:196-221`): `autocapture: false`, `capture_heatmaps: false`, `disable_session_recording: true`, `capture_exceptions: false`. Main-process init (`AnalyticsService.ts:246-259`): `privacyMode: true`, `enableExceptionAutocapture: false`. Both drop all events when `PLAYWRIGHT_TEST` is set (`before_send`).

There are **two** `posthog-node` clients in `AnalyticsService` — `postHogClient` (normal events) and `sessionTracker` (intended for retention pings). Both are created identically via `initPostHogClient()`.

### Consent model — **defaults ON, no prompt**

- **Default value:** `analyticsEnabled` defaults to `true`:
  - App-settings store default: `packages/electron/src/main/utils/store.ts:477` (`analyticsEnabled: true, // Default to enabled`)
  - `isAnalyticsEnabled()` default arg: `store.ts:1335` (`getAppStore().get('analyticsEnabled', true)`)
  - Dedicated `analytics-settings` electron-store: `AnalyticsService.ts:236-244` (`defaults: { analyticsEnabled: true, ... }`)
- **No first-run consent dialog.** No analytics/consent UI exists in the onboarding flow — confirmed: no consent component in `components/Onboarding`, and `useOnboarding.ts` has no analytics gate. The PostHog renderer client is initialized unconditionally during app boot.
- **Only control:** a single toggle "Send Anonymous Usage Data" in Settings > Advanced (`AdvancedPanel.tsx:437-442`), described as "No prompts or personal info collected."
- **Fails open:** `allowedToSendAnalytics()` (`AnalyticsService.ts:184-195`) — *"Fail open - if we can't read the setting, allow analytics"* — returns `true` on any store read error. `isAnalyticsEnabled()` (`store.ts:1333-1340`) similarly returns `true` on error.
- **`distinctId`** is a random `nimbalyst_<ULID>` generated on first run and persisted; it is not tied to any account/email, so tracking is pseudonymous-per-install. `disableGeoip: false` (`AnalyticsService.ts:254`) means PostHog performs server-side IP geolocation.

### Docs-vs-code discrepancy (retention ping)

`docs/ANALYTICS_GUIDE.md:181` claims: *"Even after opt-out, a single `nimbalyst_session_start` event is sent on each application start via the `sessionTracker` PostHog instance (which is force-opted-in)."*

**The code does not implement this.** `AnalyticsService.setSessionId()` (`AnalyticsService.ts:133-173`) returns early at line 137-140 when `!allowedToSendAnalytics()` — *before* the `sessionTracker.capture(...)` call — and `sessionTracker` is created by the same `initPostHogClient()` with no force-opt-in. So in the current code an opted-out user sends **no** events, not even a retention ping. Either the doc is stale or the intended retention ping was removed. Worth reconciling before release (the doc, if shipped/public, misrepresents behavior in the user-favorable direction, which is the safer error, but it should still be fixed).

### Events sent (representative — see `docs/POSTHOG_EVENTS.md` for the full canonical list)

Server-side (`AnalyticsService`): `nimbalyst_session_start` (with `$set`: `nimbalyst_version`, `cpu_arch`; `$set_once`: `is_dev_user`, `is_dev_install`; property `has_git_installed`), `analytics_opt_out`. Renderer (`posthog-js` `.capture()` calls, ~hundreds across the renderer): e.g. `workspace_search_used`, `ai_provider_configured`, `ai_model_selected`, `alpha_feature_toggled`, `auto_commit_toggled`, `extension_marketplace_viewed/installed/uninstalled/updated`, `extension_toggled`, `claude_plugin_installed`, `mcp_server_added`, `mcp_server_test_result`, `mcp_oauth_authorize`, `sync_enabled/disabled`, `sync_sign_in_started/completed`, `beta_feature_toggled`, `check_claude_code_windows_installation`. The codebase asserts no prompt text / document content is sent; events carry feature-usage metadata only. This audit did not exhaustively verify every property payload — recommend a separate property-level review against `docs/POSTHOG_EVENTS.md`.

---

## AI Provider Endpoints

| Provider | Endpoint | User-configurable? | File:line |
|---|---|---|---|
| Anthropic (Claude chat) | `https://api.anthropic.com` (Anthropic SDK default) | Custom `baseUrl` supported | `packages/runtime/src/ai/providers/anthropic.ts:9,12`; models: `packages/runtime/src/ai/models.ts:25` |
| OpenAI (chat) | `https://api.openai.com/v1` (OpenAI SDK default) | Custom `baseUrl` supported (`normalizeBaseUrl`) | `packages/runtime/src/ai/providers/openai.ts:5-30`; models: `models.ts:9` |
| OpenAI Realtime (Voice Mode) | `wss://api.openai.com/v1/realtime?model=<model>` | No (fixed host) | `packages/electron/src/main/services/voice/RealtimeAPIClient.ts:275-284` |
| OpenAI TTS (voice preview) | `https://api.openai.com/v1/audio/speech` | No | `packages/electron/src/main/services/voice/VoiceModeService.ts:1039` |
| LM Studio (local LLM) | `http://127.0.0.1:8234` default; user-set `baseUrl` | **Yes** — fully user-configurable URL | `packages/runtime/src/ai/server/providers/LMStudioProvider.ts:23,30,776` (calls `/v1/models`, `/v1/chat/completions`) |
| Claude Code (agent) | Anthropic API, via the user-installed `@anthropic-ai/claude-agent-sdk` CLI which manages its own endpoints | Inherits CLI/SDK config | `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` |
| OpenAI Codex (agent) | ChatGPT/OpenAI OAuth + API, via the Codex CLI; auth via `shell.openExternal(authUrl)` returned by the CLI | Inherits CLI config | `packages/electron/src/main/ipc/CodexAuthHandlers.ts:76,124` |
| OpenCode (agent protocol) | User-supplied `baseUrl` (local OpenCode server); health-checks `${baseUrl}/global/health` | **Yes** — user-supplied | `packages/runtime/src/ai/server/protocols/OpenCodeSDKProtocol.ts:189,833` |

API keys come only from explicit Nimbalyst settings — no `process.env` fallback (per CLAUDE.md policy; not re-verified line-by-line in this audit). All cloud AI traffic fires only when the user actively sends a message / starts voice mode.

---

## Auto-Update

- **Library:** `electron-updater`. **Feed:** GitHub provider, repo `nimbalyst/nimbalyst` (`packages/electron/src/main/services/autoUpdater.ts:25-29`, `GITHUB_UPDATE_PROVIDER`). Resolves to GitHub API + `objects.githubusercontent.com` for release assets. The `latest.yml` / `latest-mac.yml` channel files are generated at build time by `build/generate-update-yml.js` and published as GitHub release assets.
- **Channels:** stable uses `channel: 'latest'`; alpha uses `channel: 'alpha'` with `allowPrerelease = true` (`autoUpdater.ts:65-79`). `autoDownload = false` (no silent download), `autoInstallOnAppQuit = true`.
- **When it fires:** Only in packaged builds (`app.isPackaged`, `index.ts:2050-2055`). Initial check **30 seconds after launch**, then **every 60 minutes** (`autoUpdater.ts:537-547`, `index.ts:2052`). Also on-demand via Help menu / update toast.
- **Disable:** **No user-facing setting to disable update checks.** `stopAutoUpdateCheck()` exists but is not exposed in UI. Dev builds skip it entirely.
- **`build/validate-windows-updater-config.js`** is a build-time guard that validates the Windows updater config; it makes no network calls.

---

## Collaboration / Sync / Auth Endpoints

**Note:** the repo contains `packages/collab-protocol` (shared protocol types) but **no `packages/collabv3`** directory — the CollabV3 Cloudflare Workers server referenced in CLAUDE.md is not in this checkout (separate repo or removed). The desktop client connects to the deployed server by URL.

- **Sync server (production):** `wss://sync.nimbalyst.com`. Hardcoded in multiple places: `SyncManager.ts:318,859`, `DocumentSyncHandlers.ts:53`, `MainBodyDocService.ts:36`, `SyncPanel.tsx:135`, `store.ts:135`, `SettingsHandlers.ts:1061,1089,1140`, `collabDocumentOpener.ts:89`.
- **Sync server (development):** `ws://localhost:8790` — only used in non-production builds when `config.environment === 'development'`; production builds always force `wss://sync.nimbalyst.com` (`SyncManager.ts:321-329`).
- **`wss://collabv3.nimbalyst.workers.dev`** also appears (2 hits) as an alternate/legacy sync host — the raw Cloudflare Workers domain behind the `sync.nimbalyst.com` custom domain.
- **When it fires:** Sync is **opt-in** — `initializeSync()` returns early unless `config.enabled` (`SyncManager.ts:303-312`). Once enabled, the client opens a persistent WebSocket and reconnects automatically. HTTP variants (`https://sync.nimbalyst.com`) are used for share API calls.
- **Sharing API:** `https://sync.nimbalyst.com/share`, `/shares`, `/share/{id}` via `net.fetch` (`ShareHandlers.ts:16,336,398,472,571`). Fires only when the user shares/lists/revokes a session. Generated share links are displayed as `https://share.nimbalyst.com/share/<id>` (`sessionShares.ts:119`) — display/landing host; the API itself targets `sync.nimbalyst.com`.
- **Auth (Stytch):** `https://api.stytch.com/v1/b2b` — live B2B project. Config hardcoded in `packages/runtime/src/config/stytch.ts:10-14`: `projectId: project-live-70b810e0-...`, `publicToken: public-token-live-db5dfb0e-...` (public token only — no secret key client-side, correct). Initialized lazily on first Stytch IPC (`SettingsHandlers.ts:64-78`). Fires only when the user signs in for sync/teams. Credentials stored encrypted via Electron `safeStorage` (`StytchAuthService.ts:183-195`).
- **Key rotation / collab WebSockets:** `KeyRotationService.ts` opens `new WebSocket(url)` to the sync server (lines 250, 308, 365, 499) for team key-envelope rotation — only active when teams/sync are in use.

---

## Marketplace & Extensions

- **Nimbalyst extension registry:** `https://extensions.nimbalyst.com/registry` (`ExtensionMarketplaceHandlers.ts:36`). Fetched via Electron `net.fetch` (line 100) when the user opens the Extension Marketplace settings panel.
- **Marketplace install:** downloads a `.nimext` zip from a registry-supplied `downloadUrl` (arbitrary host) via `net.fetch` (`downloadFile`, lines 206-209), with **SHA checksum verification** before extraction (line 268). Fires on explicit user install/update action.
- **Install from arbitrary GitHub URL:** **Yes — confirmed.** `installFromGitHub()` (`ExtensionMarketplaceHandlers.ts:337-360`) parses any `github.com/{owner}/{repo}[/tree/{branch}/{subdir}]` URL and runs `git clone --depth 1 https://github.com/{repo}.git`. Supports sparse-checkout for subdirectories. This is the "manifest-only extensions from GitHub URL" feature from the commit log — it will clone from **any** GitHub repo the user pastes. No host allowlist beyond the `github.com` regex; no checksum (git-clone path). This is a deliberate user-initiated action but means extension code from any GitHub repo can land on disk.
- **Claude Code plugin marketplace:** `https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json` (`ClaudeCodePluginHandlers.ts:135`). Fetched when the Claude Code Plugins panel is opened.
- **MCP servers:** users can configure remote MCP servers pointing at arbitrary hosts. The settings UI lists presets (Zapier `https://zapier.com/mcp`, Notion `https://mcp.notion.com/mcp`, Linear `https://mcp.linear.app/mcp`, Atlassian, Sentry `https://mcp.sentry.dev/mcp`, Slack, Asana, Stripe, PostHog `https://mcp.posthog.com/sse`, etc. — see `MCPServersPanel.tsx`). These connect only when the user adds/enables them.

---

## Build-Time-Only Endpoints

These fire during `npm run build` / CI / development tooling — **not on an end-user's machine.** Users do not care about these for runtime egress.

- **GitHub release-asset publishing** — `electron-builder` `publish` config pushes artifacts to `github.com/nimbalyst/nimbalyst`. Build/CI only.
- **`build/generate-update-yml.js`, `build/generate-third-party-licenses.js`, `build/validate-windows-updater-config.js`, `build/build-extensions.js`** — all local file operations; no network calls (verified).
- **CLI tool install docs** — strings like `https://nodejs.org/en/download`, `https://www.python.org/downloads/`, `https://bun.sh/docs/installation`, `https://docs.astral.sh/uv/...`, `https://git-scm.com/install/windows`, `https://pipx.pypa.io/...`, `https://www.docker.com/products/docker-desktop/` — these are **link text shown in the UI** (install instructions), opened only via `shell.openExternal` on user click in the system browser. Not in-app fetches.
- **`source.unsplash.com/random`** — placeholder text in an image-URL input field (`packages/runtime/src/editor/plugins/ImagesPlugin/index.tsx:58`). Not fetched by the app; only if a user types/keeps that URL.

---

## Full Endpoint Inventory

Every external endpoint reference found in `packages/electron/src`, `packages/runtime/src`, `packages/collab-protocol`. "Type": `RUNTIME` = fires on user's machine; `EXTERNAL-LINK` = opened in system browser via `shell.openExternal`/`openExternal` (no in-app connection); `CONFIG` = hardcoded config consumed at runtime; `UI-TEXT` = displayed string only.

| Host / URL | File:line | Purpose | Type / When |
|---|---|---|---|
| `phc_s3lQIILexwlGHvxrMBqti355xUgkRocjMXW4LjV0ATw` (PostHog key) | `renderer/index.tsx:197`, `main/services/analytics/AnalyticsService.ts:9` | PostHog project key; sends to `us.i.posthog.com` | RUNTIME — app startup + user actions |
| `https://fonts.googleapis.com/css2?family=Material+Symbols...` | `renderer/index.css:6` | Material Symbols icon font CSS | RUNTIME — every launch |
| `https://cdn.simpleicons.org/{slug}[/color]` | `renderer/components/GlobalSettings/panels/ClaudeCodePluginsPanel.tsx:124-125`, `MCPServersPanel.tsx:144-145` | Vendor brand icons | RUNTIME — when panel opened |
| GitHub repo `nimbalyst/nimbalyst` (update feed) | `main/services/autoUpdater.ts:25-29,72,77` | `electron-updater` auto-update feed | RUNTIME — 30s after launch + every 60min (packaged only) |
| `https://api.anthropic.com` | `runtime/src/ai/providers/anthropic.ts:9,12`; `runtime/src/ai/models.ts:25` | Claude chat API | RUNTIME — user sends AI message |
| `https://api.openai.com/v1` | `runtime/src/ai/providers/openai.ts:30`; `runtime/src/ai/models.ts:9` | OpenAI chat API | RUNTIME — user sends AI message |
| `wss://api.openai.com/v1/realtime?model=...` | `main/services/voice/RealtimeAPIClient.ts:275` | OpenAI Realtime voice WebSocket | RUNTIME — user starts Voice Mode |
| `https://api.openai.com/v1/audio/speech` | `main/services/voice/VoiceModeService.ts:1039` | OpenAI TTS (voice preview) | RUNTIME — user previews a voice |
| `http://127.0.0.1:8234` (LM Studio default) | `runtime/src/ai/server/providers/LMStudioProvider.ts:23,30,776` | Local LLM `/v1/models`, `/v1/chat/completions` | RUNTIME — local, user-configurable |
| `${baseUrl}/global/health` (OpenCode) | `runtime/src/ai/server/protocols/OpenCodeSDKProtocol.ts:189` | OpenCode server health check | RUNTIME — user-supplied baseUrl |
| `wss://sync.nimbalyst.com` (production sync) | `main/services/SyncManager.ts:318,859`, `DocumentSyncHandlers.ts:53`, `MainBodyDocService.ts:36`, `SyncPanel.tsx:135`, `store.ts:135`, `SettingsHandlers.ts:1061,1089,1140` | Collaboration/sync WebSocket | RUNTIME — only when sync enabled (opt-in) |
| `ws://localhost:8790` (development sync) | `main/services/SyncManager.ts:319,859`, `DocumentSyncHandlers.ts:54`, `MainBodyDocService.ts:37`, `SyncPanel.tsx:136`, `SettingsHandlers.ts:1058,1086,1138` | Dev sync WebSocket | RUNTIME — dev builds only |
| `wss://collabv3.nimbalyst.workers.dev` | (2 hits, sync config) | Raw Cloudflare Workers sync host behind custom domain | CONFIG / RUNTIME — alternate sync host |
| `https://sync.nimbalyst.com` (`/share`, `/shares`, `/share/{id}`) | `main/ipc/ShareHandlers.ts:16,336,398,472,571` | Document/session sharing API | RUNTIME — user shares/lists/revokes |
| `https://share.nimbalyst.com/share/{id}` | `renderer/store/atoms/sessionShares.ts:119`, `SharedLinksPanel.tsx:205` | Share link landing URL (displayed) | UI-TEXT / EXTERNAL-LINK |
| `https://api.stytch.com/v1/b2b` | `runtime/src/config/stytch.ts:14,27`; `main/services/StytchAuthService.ts:121` | Stytch authentication (live B2B) | RUNTIME — user sign-in for sync/teams |
| `https://test.stytch.com/v1` | `main/services/StytchAuthService.ts:121` (comment) | Stytch test env (not used in live config) | CONFIG — test only |
| `https://extensions.nimbalyst.com/registry` | `main/ipc/ExtensionMarketplaceHandlers.ts:36,100` | Extension marketplace registry | RUNTIME — when marketplace panel opened |
| marketplace `downloadUrl` (arbitrary host) | `main/ipc/ExtensionMarketplaceHandlers.ts:206-209,262` | `.nimext` package download (checksum-verified) | RUNTIME — user install/update |
| `https://github.com/{owner}/{repo}.git` (arbitrary) | `main/ipc/ExtensionMarketplaceHandlers.ts:356,359` | git-clone extension from user-pasted GitHub URL | RUNTIME — explicit user install |
| `https://raw.githubusercontent.com/anthropics/claude-plugins-official/.../marketplace.json` | `main/ipc/ClaudeCodePluginHandlers.ts:135` | Claude Code official plugin marketplace manifest | RUNTIME — when plugins panel opened |
| ChatGPT/OpenAI OAuth `authUrl` (from Codex CLI) | `main/ipc/CodexAuthHandlers.ts:76,124` | Codex agent sign-in | EXTERNAL-LINK — user sign-in |
| `https://developers.openai.com/codex` | `main/ipc/CodexAuthHandlers.ts:15` | Codex docs link | EXTERNAL-LINK / UI-TEXT |
| `https://status.anthropic.com` | `renderer/.../ClaudeUsagePopover.tsx:244`; `runtime/.../ApiServiceErrorWidget.tsx:71`; `ClaudeCodeProvider.ts:1020` | Anthropic status page | EXTERNAL-LINK / UI-TEXT — user click |
| `https://status.claude.com` | `runtime/src/ui/AgentTranscript/components/ApiServiceErrorWidget.tsx:205` | Claude status page | EXTERNAL-LINK — user click |
| `https://status.openai.com` | `renderer/.../CodexUsagePopover.tsx:231` | OpenAI status page | EXTERNAL-LINK — user click |
| `https://docs.nimbalyst.com/` | `main/menu/ApplicationMenu.ts:1621,1783` | Docs link | EXTERNAL-LINK — Help menu |
| `https://chromewebstore.google.com/.../nimbalyst-web-clipper/...` | `main/menu/ApplicationMenu.ts:1631,1793` | Web clipper extension page | EXTERNAL-LINK — Help menu |
| `https://github.com/nimbalyst/nimbalyst/issues` | `main/menu/ApplicationMenu.ts:1691,1853` | Issue tracker | EXTERNAL-LINK — Help menu |
| `https://github.com/nimbalyst/nimbalyst/discussions` | `main/menu/ApplicationMenu.ts:1701,1863` | Discussions | EXTERNAL-LINK — Help menu |
| `https://discord.gg/ubZDt4esEn` | `main/menu/ApplicationMenu.ts:1712,1874` | Discord invite | EXTERNAL-LINK — Help menu |
| `https://youtube.com/@nimbalyst` | `main/menu/ApplicationMenu.ts:1720,1882` | Social link | EXTERNAL-LINK — Help menu |
| `https://linkedin.com/company/nimbalyst` | `main/menu/ApplicationMenu.ts:1727,1889` | Social link | EXTERNAL-LINK — Help menu |
| `https://x.com/nimbalyst` | `main/menu/ApplicationMenu.ts:1734,1896` | Social link | EXTERNAL-LINK — Help menu |
| `https://www.tiktok.com/@nimbalyst` | `main/menu/ApplicationMenu.ts:1741,1903` | Social link | EXTERNAL-LINK — Help menu |
| `https://www.instagram.com/nimbalyst` | `main/menu/ApplicationMenu.ts:1748,1910` | Social link | EXTERNAL-LINK — Help menu |
| `https://platform.openai.com/api-keys` | `renderer/components/ApiKeyDialog/ApiKeyDialog.tsx:63` | OpenAI key-creation link | EXTERNAL-LINK — settings |
| `https://app.posthog.com/settings/user-api-keys` | `renderer/.../MCPServersPanel.tsx:244` | PostHog MCP key setup link | EXTERNAL-LINK / UI-TEXT |
| `https://source.unsplash.com/random` | `runtime/src/editor/plugins/ImagesPlugin/index.tsx:58` | Placeholder text in image-URL input | UI-TEXT — not fetched by app |
| MCP preset URLs (`zapier.com/mcp`, `mcp.notion.com/mcp`, `mcp.linear.app/mcp`, `mcp.atlassian.com/v1/sse`, `mcp.sentry.dev/mcp`, `mcp.slack.com/mcp`, `mcp.asana.com/sse`, `docs.stripe.com/mcp`, `mcp.posthog.com/sse`, etc.) | `renderer/components/GlobalSettings/panels/MCPServersPanel.tsx` (various) | Remote MCP server presets | RUNTIME — only if user adds/enables |
| Various install-doc links (`nodejs.org`, `python.org`, `bun.sh`, `docs.astral.sh`, `git-scm.com`, `pipx.pypa.io`, `docker.com`, `lmstudio.ai`, GitHub MCP-server repos) | scattered settings panels | CLI/tool install instructions | EXTERNAL-LINK / UI-TEXT — user click |

### Negative findings (searched, not present)

- No Sentry / Mixpanel / Amplitude / Segment / Datadog / Bugsnag SDK as telemetry. (`sentry`, `posthog` appear only as user-addable *MCP server* options.)
- No Google Analytics / `gtag`.
- Electron `crashReporter` is **not** initialized — no crash uploads.
- No hardcoded public IP addresses (only `127.0.0.1` / `localhost` for local services).
- No additional first-party domains beyond `nimbalyst.com` / `sync.nimbalyst.com` / `share.nimbalyst.com` / `extensions.nimbalyst.com` / `docs.nimbalyst.com` / `collabv3.nimbalyst.workers.dev`.

---

## Recommended actions before signed release

1. **Add a first-run analytics consent prompt** (or flip the default to OFF). Shipping with telemetry default-ON and no prompt is the most privacy-sensitive finding and may conflict with GDPR/CCPA expectations.
2. **Reconsider "fail open"** in `allowedToSendAnalytics()` / `isAnalyticsEnabled()` — a store read error should fail *closed* (no telemetry), not open.
3. **Reconcile `docs/ANALYTICS_GUIDE.md`** with the actual code — the documented opt-out "retention ping" is not implemented.
4. **Consider self-hosting the Material Symbols font** to remove the unconditional `fonts.googleapis.com`/`fonts.gstatic.com` egress (a per-launch IP leak to Google). Likewise consider bundling the simpleicons SVGs.
5. **Optionally expose an auto-update toggle** for enterprise/air-gapped users.
6. **Document the arbitrary-GitHub-URL extension install** as a trust boundary — it git-clones from any repo with no allowlist; ensure the UI surfaces an appropriate risk warning (an `extension_marketplace_risk_accepted` event exists, suggesting one is shown — verify it also covers the GitHub-URL path).
