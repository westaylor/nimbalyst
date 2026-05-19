# Supply-Chain Security Audit — Nimbalyst Desktop App

**Date:** 2026-05-19
**Repo:** `/Users/west/projects/nimbalyst` (npm-workspaces monorepo, lockfileVersion 3)
**Scope:** Defensive pre-release audit. Source: `npm audit --json` (`/tmp/claude/nimbalyst-audit.json`) — 0 critical, 19 high, 79 moderate, 5 low (103 advisories) across 1973 dependencies.

## Verdict

**No CRITICAL advisories. The headline counts are badly inflated by build-time noise.** Once the eslint / vitest / vite / electron-builder / @microsoft/api-extractor / wrangler-miniflare / postcss-tooling / happy-dom / jsdom toolchain is filtered out, the genuinely *shipped, runtime* exposure is small and almost entirely **low real-world severity**: the vulnerable code paths are not reachable with attacker-controlled input in this app, or the data they process is trusted. Of the ~103 advisories, roughly **18 touch code that ships in the packaged Electron app**, and of those the only ones worth acting on before a signed release are: **`electron` itself (3 moderate Chromium/IPC bugs — bump the patch line)**, **`dompurify` inside `monaco-editor` (XSS — only matters if the app renders untrusted HTML through Monaco's hover/markdown widgets)**, and **`@anthropic-ai/sdk` insecure default file permissions on the memory tool** (a real local-confidentiality bug worth a bump). Everything else is either dev-only, a DoS on input the app already trusts, or a transitive chain (`posthog-js → @opentelemetry → protobufjs`) where the vulnerable protobuf decode path is never fed attacker-controlled wire bytes. Lockfile hygiene is **clean** (all 1945 resolutions are HTTPS npmjs.org with sha512 integrity, no git/github sources, 18 `peer: true` flags intact). No third-party dependency runs an arbitrary `postinstall` — the only repo-authored install hook is `electron-builder install-app-deps` in `packages/electron`. Native binaries (`@vscode/ripgrep`, `node-pty`, `bufferutil`, `electron`, `sharp`) all resolve from npmjs.org with integrity hashes; the AI-CLI binary packages (`@openai/codex`, `@zed-industries/codex-acp`, `ghostty-web`) ship as prebuilt artifacts with **no install scripts**.

**Bottom line:** shippable as-is from a CRITICAL standpoint. Apply the "safe bumps" list (`electron`, `electron-store`, `mermaid`, `express-rate-limit`, `uuid`, `ws`, `posthog-js`, `nanoid`, `elliptic`) before the signed release to clear the genuine runtime advisories and most of the noise. The `@anthropic-ai/sdk` permissions bump needs a quick functional check of the Claude memory tool.

---

## CVE Triage Table

Sorted runtime-first, then by severity. **Runtime/shipped** = vulnerable code is inside the packaged app the user runs. **Build-time** = toolchain only, never on a user machine. "Fix" reflects whether a non-breaking upgrade clears it.

### Runtime / Shipped

| Package | Sev | Advisory | Pulled in by | Fix available? | Recommended action |
|---|---|---|---|---|---|
| `electron` 41.0.4 | moderate | Use-after-free in offscreen shared-texture `release()`; crash in `clipboard.readImage()` on malformed image; `window.open` named targets not scoped to opener | direct devDep of `packages/electron`, but **ships as the runtime** | Yes — patch line `41.6.1` available | **Bump to `electron@41.6.1`** (same major, low risk). App does not use offscreen rendering, so UAF is low-impact; clipboard crash is a local DoS only. |
| `@anthropic-ai/sdk` 0.81.0 | moderate | Insecure default file permissions in Local Filesystem Memory Tool (memory files written world-readable) | direct dep `packages/electron`, `packages/runtime` | No clean fix in 0.x audit metadata; latest is `0.97.1` | **Bump to `@anthropic-ai/sdk@^0.97.x`** and verify memory-tool file mode. Real local-confidentiality bug if the Claude memory tool is used and writes secrets to disk. |
| `dompurify` 3.2.7 | moderate | 8 advisories: mutation-XSS, `ADD_ATTR`/`ADD_TAGS` bypasses, `USE_PROFILES` prototype pollution, `SAFE_FOR_TEMPLATES` bypass, `CUSTOM_ELEMENT_HANDLING` PP→XSS | nested under `monaco-editor` (`monaco-editor/node_modules/dompurify`) | No fix via monaco bump — monaco 0.55.1 is already latest and pins the old dompurify | **Accept / monitor.** Reachable only if Monaco renders untrusted HTML in hover/markdown widgets. Audit whether any Monaco hover content is attacker-controlled (Code package — see Direct Dependency Risk Notes). A top-level `dompurify` override is risky (monaco pins it for a reason). |
| `monaco-editor` 0.55.1 | moderate | inherits `dompurify` advisories above | direct dep `packages/electron`, `packages/runtime` | No — 0.55.1 is latest stable | Same as `dompurify` row. Already on latest. |
| `@modelcontextprotocol/sdk` 1.29.0 | high | via `ajv` / `ajv-formats` / `fast-uri` / `express-rate-limit` / `hono` chain | direct dep `packages/electron` | No clean fix — 1.29.0 is already latest 1.x | **Accept.** The high rating is inherited entirely from the transitive `ajv→fast-uri` path-traversal advisory; the MCP SDK does not expose `fast-uri` to attacker input. |
| `electron-store` 8.2.0 | high | via `conf` → `ajv` → `fast-uri` path traversal | direct dep `packages/electron` | Yes but **major** — `electron-store@10/11` use `conf@14` (clean `ajv`) | **Bump to `electron-store@10.x`** — needs testing (ESM-only, `conf@14` API). v8→v10 is a breaking major. Clears the `high` rating. |
| `conf` 10.2.0 | high | `ajv` / `ajv-formats` (see `fast-uri`) | transitive of `electron-store` | Resolved by `electron-store` bump | Bump via `electron-store`. |
| `ajv` 8.18.0 | high | `fast-uri` path traversal + host confusion | direct devDep (root), via `ajv-formats`, `conf` | No — depends on `fast-uri` patch | **Accept.** `ajv` is used for JSON-schema validation of trusted internal schemas, not attacker URIs. `fast-uri` path traversal needs an attacker-supplied URI reaching `$ref` resolution. |
| `fast-uri` 3.1.0 | high | path traversal via percent-encoded dot segments; host confusion | transitive of `ajv` | No patched version in audit metadata | **Accept / monitor** for upstream patch. Not exploitable unless app resolves attacker-controlled URI `$ref`s. |
| `express-rate-limit` 8.3.2 (root) / 7.5.1 (electron) | moderate | via `ip-address` XSS in `Address6` HTML-emitting methods | direct dep root + `packages/electron` | Yes — bump clears it | **Bump `packages/electron` to `express-rate-limit@^8.x`** to converge versions; `ip-address` XSS only fires if you render `Address6.inspect()` HTML — app does not. Low real risk; bump is cheap. |
| `ip-address` 10.1.0 | moderate | XSS in `Address6` HTML-emitting methods | transitive of `express-rate-limit` | No direct patch | Accept — see row above. App never renders `ip-address` HTML output. |
| `uuid` 11.1.0 | moderate | Missing buffer bounds check in v3/v5/v6 when `buf` is provided | direct dep `packages/electron`; also via `mermaid` | Yes — `uuid@14` | **Bump to `uuid@14`** (major, but uuid majors are low-friction; mostly ESM/types). App does not pass the `buf` argument, so not exploitable today — bump for hygiene. |
| `mermaid` 11.14.0 | moderate | Gantt-chart infinite-loop DoS; `classDef`/`classDefs` CSS injection; `classDef` state-diagram HTML injection; pulls vulnerable `dagre-d3-es`/`uuid` | direct dep `packages/electron`, `packages/runtime` | Yes — `mermaid@11.15.0` | **Bump to `mermaid@11.15.0`** (same major, safe). Mermaid renders user-authored diagrams; CSS/HTML injection matters if diagram source is ever from an untrusted document. |
| `dagre-d3-es` 7.0.14 | moderate | `lodash-es` prototype pollution | transitive of `mermaid` | `mermaid@11.15` still pins `dagre-d3-es@7.0.14` (still ships `lodash-es`) | Accept — mermaid layout code only; not fed attacker prototype paths. |
| `lodash-es` 4.17.x/4.18.1 | high | Prototype pollution in `_.unset`/`_.omit`; code injection via `_.template` import key names | via `mermaid`/`dagre-d3-es`, `chevrotain`, `packages/runtime` | No — `lodash-es` upstream | **Accept.** `_.template` is not used with attacker input; `_.unset`/`_.omit` PP needs attacker-controlled path arrays. Both unreachable in mermaid/chevrotain usage. |
| `posthog-js` 1.341.1 | high | via `@opentelemetry/exporter-logs-otlp-http` → `otlp-transformer` → `protobufjs` | direct dep `packages/electron`, `packages/runtime` | Bump available (`1.374.2`) but **still pulls the same otel/protobufjs chain** | **Bump to `posthog-js@^1.374.x`** for general currency, but it does NOT clear the `high` — see `protobufjs`. The protobuf decode path is never fed attacker wire bytes (analytics egress only), so the inherited `high` is not a real exposure. |
| `protobufjs` 7.5.5 | high | 9 advisories: code injection via bytes-field defaults, PP in generated constructors, unbounded recursion DoS, overlong UTF-8 | transitive: `posthog-js → @opentelemetry/otlp-transformer` | `protobufjs@8.4.0` exists but is not reachable without an opentelemetry major bump | **Accept.** Nimbalyst only *encodes* analytics protobufs for outbound OTLP export; it never *decodes* attacker-controlled protobuf input, which is what every protobufjs advisory requires. Not a real runtime exposure. |
| `@protobufjs/utf8` | moderate | overlong UTF-8 decoding | transitive of `protobufjs` | No | Accept — same reasoning as `protobufjs`. |
| `ws` 8.19.0 | moderate | Uninitialized memory disclosure | direct dep `packages/electron`; also via `openai`, `jsdom` | Yes — `ws@8.20.1` | **Bump to `ws@8.20.1`** (patch, safe). Affects servers that accept `permessage-deflate` from untrusted peers; app's `ws` usage is mostly client-side, low risk, but bump is free. |
| `openai` 6.19.0 / 4.104.0 | moderate | via `ws` | direct dep `packages/electron` (6.x), `packages/runtime` (4.x) | Resolved by `ws` bump | Bump `ws`; consider converging `packages/runtime` `openai@4` → `6` separately (not a security blocker). |
| `nanoid` 4.0.2 | moderate | Predictable results when given non-integer size | via `@excalidraw/mermaid-to-excalidraw`/`mermaid` | Yes — fix available | **Bump** (cheap). Not used for security tokens here; hygiene only. |
| `@anthropic-ai/claude-agent-sdk` 0.2.126 | moderate | inherits `@anthropic-ai/sdk` + `@modelcontextprotocol/sdk` advisories | direct dep + **`overrides` pin** to exact `0.2.126` | Inherited only — bumping the override would clear the `@anthropic-ai/sdk` portion | Keep pinned for now (see Overrides Analysis). The moderate is fully inherited. |
| `@excalidraw/mermaid-to-excalidraw` | moderate | via `mermaid` / `nanoid` | direct dep | Partially via `mermaid`/`nanoid` bumps | Bump `mermaid` + `nanoid`; residual is the mermaid chain. |
| `jimp` 1.6.0 (+ all `@jimp/*`) | moderate | via `@jimp/core` → `file-type` infinite-loop on malformed ASF input | direct dep `packages/electron` | `npm audit` says fix available for the `@jimp/*` sub-packages but **not** `jimp` itself or `file-type` | **Accept / monitor.** `file-type` ASF infinite-loop DoS requires processing a malformed media file through jimp. If jimp only handles user-opened images locally, this is a self-inflicted DoS, not a remote one. Watch for a `jimp`/`file-type` patch. |
| `file-type` 16.5.4 | moderate | infinite loop in ASF parser on zero-size sub-header | transitive of `jimp/@jimp/core` | No | Accept — see `jimp` row. |
| `node-stdlib-browser` → `crypto-browserify` → `elliptic` | low | Elliptic risky cryptographic primitive implementation | via `vite-plugin-node-polyfills` (renderer polyfill bundle) | Yes — `elliptic` fix available | **Bump `elliptic`** transitively (cheap, low). Only matters if renderer code actually uses `crypto`-polyfilled ECDSA — likely unused; hygiene. |

### Build-time / Dev-only (never on a user's machine — lower priority)

| Package | Sev | Advisory | Why dev-only |
|---|---|---|---|
| `@microsoft/api-extractor` (+ `-model`, `@rushstack/*`, `@microsoft/tsdoc-config`) | high | via `ajv`/`minimatch` | API doc-extraction toolchain; used by `tsup`/`vite-plugin-dts` at build only |
| `vite`, `vite-node`, `@vitejs/plugin-react`, `vite-plugin-dts`, `vite-plugin-node-polyfills`, `vite-plugin-static-copy` | moderate | via `postcss`/`esbuild`/`node-stdlib-browser` | bundler — build-time only |
| `vitest`, `@vitest/mocker`, `@vitest/ui` | moderate | via `vite`/`happy-dom`/`jsdom` | test runner |
| `happy-dom`, `jsdom` | moderate | via `ws` uninitialized memory | test DOM environments |
| `electron-builder`, `app-builder-lib`, `dmg-builder`, `electron-builder-squirrel-windows` | moderate | via `minimatch` | packaging toolchain |
| `electron-vite` | moderate | via `vite` | build orchestration |
| `typescript-eslint` (+ `@typescript-eslint/*`) | moderate | via `minimatch` | linter |
| `tsup` | moderate | via `@microsoft/api-extractor`/`postcss` | extension-SDK build |
| `wrangler`, `miniflare` | moderate | via `ws` | Cloudflare Workers dev server (collabv3) — never in desktop app |
| `tailwindcss`, `autoprefixer`, `postcss`, `postcss-import`, `postcss-js`, `postcss-load-config`, `postcss-nested` | moderate | PostCSS XSS in stringify output | CSS build toolchain; `postcss` "XSS" needs attacker CSS at build time |
| `@lexical/headless` | moderate | via `happy-dom` | test-only Lexical headless mode |
| `chevrotain`, `chevrotain-allstar`, `@chevrotain/*`, `langium`, `@mermaid-js/parser` | moderate | via `lodash-es` | mermaid grammar parser — parses trusted diagram grammar; effectively build/parse-time |
| `glob`, `minimatch`, `brace-expansion` | moderate | `brace-expansion` numeric-range DoS | glob matching; DoS needs attacker-controlled glob pattern |
| `browserify-sign`, `create-ecdh`, `crypto-browserify`, `elliptic` | low | `elliptic` risky primitive | renderer crypto polyfill (see runtime row — likely unused) |
| `@hono/node-server`, `hono` | moderate | Hono JSX/JWT/cache/body-limit advisories | `hono` is the collabv3 Worker framework — server-side, not in desktop app |
| `@opentelemetry/*` | high/moderate | via `protobufjs` | only reached through `posthog-js` analytics egress (see runtime table) |

---

## Recommended Dependency Bumps

A separate step applies these. Order matters: do the safe bumps first, re-run `npm audit`, then evaluate the "needs testing" group.

### Safe bumps (same-major or low-friction; apply directly)

| # | Package | File(s) | Current | Target | Fixes | Breaking risk |
|---|---|---|---|---|---|---|
| 1 | `electron` | `packages/electron/package.json` devDep **and** `build.electronVersion` **and** `build.buildVersion` context | `41.0.4` | `41.6.1` | 3 moderate Chromium/IPC advisories (UAF, clipboard crash, `window.open` scoping) | **Low** — same major (41.x). Re-run E2E + smoke test. Update `electronVersion: "41.6.1"` in the `build` block to match. |
| 2 | `mermaid` | `packages/electron/package.json`, `packages/runtime/package.json` | `^11.12.0` (resolves 11.14.0) | `^11.15.0` | Gantt DoS, `classDef`/`classDefs` CSS+HTML injection | **Low** — same major (11.x). |
| 3 | `ws` | `packages/electron/package.json` | `^8.19.0` | `^8.20.1` | Uninitialized memory disclosure | **None** — patch bump. |
| 4 | `express-rate-limit` | `packages/electron/package.json` | `^7.5.1` | `^8.5.2` | converges with root `8.x`; clears `ip-address` chain dedupe | **Low** — v7→v8 is a minor API change (store interface); the electron app uses default store. Verify rate-limit middleware still mounts. |
| 5 | `nanoid` | transitive (via `mermaid`/`@excalidraw/mermaid-to-excalidraw`) — resolves once `mermaid` is bumped, or add an `overrides` entry `"nanoid": "^5.0.9"` | `4.0.2` | `^5.x` (or whatever the `mermaid@11.15` tree resolves) | non-integer-size predictability | **Low** — not used for security tokens. |
| 6 | `posthog-js` | `packages/electron/package.json`, `packages/runtime/package.json` | `^1.280.1` (resolves 1.341.1) | `^1.374.2` | general currency (does NOT clear the otel/protobufjs `high` — that chain is non-exploitable) | **Low** — same major. |
| 7 | `elliptic` | transitive (via `vite-plugin-node-polyfills` → `node-stdlib-browser` → `crypto-browserify`) — add `overrides` `"elliptic": "^6.6.x"` if not auto-resolved | `6.6.1` | latest `6.6.x` patched | risky crypto primitive (low) | **None** — patch within 6.x. |

### Needs testing (breaking majors / behavior change — stage and verify)

| # | Package | File(s) | Current | Target | Fixes | Breaking risk / test plan |
|---|---|---|---|---|---|---|
| 8 | `@anthropic-ai/sdk` | `packages/electron/package.json`, `packages/runtime/package.json` | `^0.81.0` | `^0.97.x` | Insecure default file permissions on Memory Tool | **Medium** — 0.81→0.97 is many minor releases; SDK surface (message params, streaming) may have shifted. **Test:** Claude provider streaming + tool use, and confirm memory-tool files are written `0600`. Note the root `overrides` pins `@anthropic-ai/claude-agent-sdk@0.2.126` which carries its own `@anthropic-ai/sdk` — keep them consistent. |
| 9 | `electron-store` | `packages/electron/package.json` | `^8.2.0` | `^10.x` | `conf@14` → clean `ajv` (clears the `high`) | **High** — v8→v10 is a breaking major: v9+ is ESM-only and `conf@14` changed defaults/migration API. The `build.files` allowlist in `packages/electron/package.json` explicitly enumerates `electron-store`, `conf`, `ajv`, `ajv-formats`, `fast-uri`, `dot-prop`, `atomically`, etc. — **this allowlist must be re-derived** after the bump (the dependency tree changes; `ajv`/`fast-uri` may drop out, `type-fest@4` is added). Test settings read/write/migration end-to-end. |
| 10 | `uuid` | `packages/electron/package.json` | `^11.1.0` | `^14.0.0` | v3/v5/v6 buffer bounds check | **Low–Medium** — uuid majors are mostly ESM/build changes; app uses `v4`. Run unit tests + a build. Can also be deferred (app never passes the `buf` arg, so not exploitable today). |
| 11 | `openai` (runtime) | `packages/runtime/package.json` | `^4.104.0` | `^6.x` (converge with electron) | dedupes `ws`; removes a stale major | **Medium** — openai v4→v6 has real API changes (client construction, streaming events). Not a security blocker; do as a separate hygiene task, not part of the release. |

### Explicitly NOT recommended

- **Do not** add a top-level `dompurify` override to force-upgrade the copy inside `monaco-editor`. Monaco pins `dompurify@3.2.7` deliberately; a forced bump can break Monaco's sanitizer integration. Instead audit whether Monaco hover/markdown ever renders untrusted HTML.
- **Do not** attempt to bump `protobufjs`/`@opentelemetry/*` out of `posthog-js` — the chain is non-exploitable here and forcing it risks breaking analytics.
- **Do not** chase the build-time advisories for a release — they never reach a user's machine.

---

## Lockfile Hygiene

**Status: clean.** Inspected `package-lock.json` (`lockfileVersion: 3`).

- **Integrity:** All **1945** `resolved` entries that point at an HTTP(S) URL carry a `sha512` `integrity` hash. `0` resolutions missing integrity.
- **Registry:** Every external `resolved` URL is `https://registry.npmjs.org/...`. No `http://` (plaintext) URLs. No alternate/private registries.
- **Git/GitHub sources:** **None.** No dependency resolves from a `git+`, `github:`, or tarball-URL source. The only non-URL `resolved` values are the 22 workspace packages (`packages/electron`, `packages/runtime`, `packages/extensions/*`, etc.) — expected for an npm-workspaces monorepo.
- **`peer: true` flags:** **18** present and intact. The root `CLAUDE.md` warns these get stripped by some npm versions (breaks CI for optional native binaries like esbuild platform packages). Current state is healthy — **verify this count is still 18 after applying any bumps**; if a bump strips them, investigate before committing the lockfile.
- **Duplicate versions:** several packages are installed at multiple versions (`ws` at 6.2.3/7.5.10/8.18.0/8.19.0, `ajv` at 6.14.0/8.18.0, `minimatch` at 3.x–10.x, `electron` at 41.0.4 and 41.2.1, `esbuild` at 0.25.10/0.25.12/0.27.3/0.27.4, `lodash-es` at 4.17.21/4.18.1, `openai` at 4.104.0/6.19.0). This is normal npm hoisting, not a hygiene defect, but it does mean a single bump may not dedupe all copies — re-run `npm audit` after bumps to confirm.

---

## Install Lifecycle Scripts

**Repo-authored hooks** (scanned root + all `packages/*` + `packages/extensions/*` `package.json`):

| File | Hook | Command | Assessment |
|---|---|---|---|
| `packages/electron/package.json` | `postinstall` | `electron-builder install-app-deps \|\| true` | **Expected.** Rebuilds native modules (`node-pty`, `bufferutil`, `sharp`) against Electron's ABI. First-party, well-known. The `\|\| true` swallows failures — acceptable for dev ergonomics. |
| `packages/extension-sdk/package.json` | `prepublishOnly` | `npm run build` | Runs only on `npm publish` of the SDK, not on consumer install. Benign. |

Root `package.json` has **no** `preinstall`/`postinstall`/`install`/`prepare`.

**Third-party dependencies with install hooks** (from `package-lock.json` `hasInstallScript` flags — there is no top-level `node_modules` checked out, so the lockfile is authoritative): **21 packages** carry an install script. All are well-known native-build or binary-fetch packages, all resolved from `registry.npmjs.org` with integrity hashes:

`@vscode/ripgrep`, `bufferutil`, `core-js`, `electron` (×2: 41.0.4, 41.2.1), `esbuild` (×4 versions), `electron-winstaller`, `fsevents` (×2), `leveldown`, `node-pty`, `playwright-electron`, `protobufjs`, `sharp`, `utf-8-validate`, `workerd`.

- **`@vscode/ripgrep`, `electron`, `playwright-electron`, `workerd`** — postinstall *downloads a prebuilt binary*. These fetch from their own CDNs (GitHub releases / Microsoft / Cloudflare). The npm-package tarball integrity is verified, but the *downloaded binary* is verified by the package's own logic (ripgrep and electron both checksum their downloads). `workerd`/`electron-winstaller` are dev/build-only.
- **`bufferutil`, `utf-8-validate`, `node-pty`, `leveldown`, `fsevents`, `core-js`** — node-gyp native compilation (`fsevents`/`core-js` have prebuilt fallbacks). Standard, no remote fetch beyond npm.
- **`esbuild`, `sharp`, `protobufjs`** — postinstall installs the correct platform binary / runs setup; all from npm.

**No unrecognized or suspicious third-party install hook.** No dependency with an install script comes from a non-npmjs source. The supply-chain install-time attack surface is limited to the standard native-toolchain set, which is acceptable for an Electron app.

> Note: the npm cache at `~/.npm/_cacache` has root-owned files (`EPERM` on `npm audit fix --dry-run`). This is a local environment issue, not a repo finding — `sudo chown -R 501:20 ~/.npm` resolves it. It blocked the `npm audit fix` dry-run, so fix targets above were derived from the lockfile + `npm view`.

---

## Overrides Analysis

Root `package.json` `overrides` block (4 entries):

| Override | Value | Purpose | Risk |
|---|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | `0.2.126` (exact pin) | **Version lock**, not a rewire. Forces every workspace (electron declares `^0.2.126`, runtime declares `^0.2.126`) onto exactly `0.2.126` so the bundled-binary platform packages (`claude-agent-sdk-darwin-${arch}`, referenced in `build.mac.extraResources`) stay version-matched. Latest upstream is `0.3.144`. | **Low, intentional.** Exact pin is the right call when you ship matching native binaries — a floating range could desync the JS package from the unpacked binary. Trade-off: you must manually bump it to pick up SDK fixes. Revisit when moving to the `0.3.x` line. |
| `prismjs` | `^1.30.0` | **Security floor.** Forces all transitive `prismjs` (syntax highlighting, pulled by `react-syntax-highlighter` / docs tooling) to ≥1.30.0, which is the version that fixed prior prismjs DOM-clobbering / ReDoS advisories. | **None — this is good practice.** Keep it. |
| `vite` | `^7.0.0` | **Transitive unification.** Many tools (`electron-vite`, `vite-plugin-*`, `vitest`, `tsup`) declare wide `vite` ranges (`^5 || ^6 || ^7`). The override forces the whole tree onto Vite 7 so there is one bundler version. | **Low.** Build-time only. The `npm audit` warnings (`peer overridden vite@^7.0.0`) are the expected, benign consequence of this override. No runtime risk. |
| `zod` | `^4.0.0` | **Transitive unification.** Forces a single `zod@4` across the tree (electron + runtime both declare `zod@^4`, but MCP SDK / agent SDK may pull `zod@3`). Prevents the dual-`zod` "instanceof fails across versions" class of bugs. | **Low–Medium.** `zod@3→4` is a real breaking change; forcing a transitive dependency that expected `zod@3` onto `zod@4` *can* break it. Worth a spot-check that `@modelcontextprotocol/sdk@1.29.0` and `@anthropic-ai/*` SDKs function with `zod@4` — they declare `zod@^3` peer ranges in some releases. If MCP tool schema validation works in practice, leave it; otherwise this override is a latent footgun. |

**Overall:** all four overrides are defensible. `prismjs` is a security floor (keep). `vite`/`zod` are de-duplication (keep, but `zod` deserves a functional check). `@anthropic-ai/claude-agent-sdk` exact-pin is correct for binary-coupled packages. **No override is rewiring a dependency to a malicious or unexpected source.**

---

## Direct Dependency Risk Notes

Scanned direct deps of root, `packages/electron`, `packages/runtime`.

- **AI-SDK packages pinned to exact / tight versions** (noted as requested):
  - `@anthropic-ai/claude-agent-sdk` — `^0.2.126` declared, **hard-pinned to `0.2.126`** by the root override. 0.x = pre-1.0, API can break between minors. Pin is intentional (binary coupling). Upstream is `0.3.144` — a major-ish jump deferred.
  - `@anthropic-ai/sdk` — `^0.81.0`. 0.x pre-1.0. Has the Memory-Tool file-permissions advisory; bump to `0.97.x` recommended (see bumps table).
  - `@openai/codex-sdk` — `^0.130.0` (electron + runtime). 0.x pre-1.0, ships a native binary (`@openai/codex-darwin-${arch}` in `extraResources`).
  - `@openai/codex` — `0.130.0` (referenced in `build.files`), bundled binary, no install script.
  - `@agentclientprotocol/sdk` — `^0.20.0` (runtime). 0.x.
  - `@zed-industries/codex-acp` — `^0.12.0` (runtime), bundled native binary. 0.x.
  - `@opencode-ai/sdk` — `^1.3.0` (runtime).
  - `@modelcontextprotocol/sdk` — `^1.29.0`, currently the latest 1.x.
  These are all fast-moving pre-1.0 (or young 1.x) packages from known vendors (Anthropic, OpenAI, Zed, the MCP org). The risk is **API churn**, not malice. Pre-1.0 ranges with `^` can pull breaking minors — consider tightening `@anthropic-ai/sdk` and `@openai/codex-sdk` to `~` (tilde) ranges so a CI install can't silently jump a breaking minor.
- **`electron` version mismatch:** `packages/electron` declares `41.0.4` and `build.electronVersion: "41.0.4"`, but the lockfile also resolves `electron@41.2.1` elsewhere in the tree. Bumping (recommended `41.6.1`) should converge these — verify the `build.electronVersion` field is updated to match the installed runtime, or `electron-builder` may package the wrong ABI.
- **`monaco-editor` `^0.55.1`** — pre-1.0 versioning is normal for Monaco (it has always shipped `0.x`). Already on latest stable; the bundled `dompurify@3.2.7` is the only concern (covered above).
- **No deprecated direct dependencies** were flagged by the audit. `node-fetch@3` (electron) and the `formdata-node`/`form-data-encoder` set are current.
- **No prerelease/RC/beta of a security-sensitive package** in the direct dependency lists — versions are all stable releases (the only `-dev` tag seen, `monaco-editor@0.56.0-dev-*`, is the `next` dist-tag and is **not** used).
- **`prettier@^2.8.8`** in `packages/runtime` deps (not devDeps) — Prettier 2.x is old (current is 3.x) but it is build/format tooling, not a runtime security concern; noting for hygiene only.
- **Single-anonymous-maintainer / low-download packages:** nothing in the direct dependency lists stands out as an obscure single-maintainer package — `ghostty-web`, `virtua`, `ulid`, `pathe`, `chardet`, `pkce-challenge` are all reasonably-adopted. `ghostty-web@0.4.0` is the youngest/newest direct dep (0.x, terminal rendering); it ships no install script and is a thin WASM wrapper — low concern, but worth keeping an eye on as it matures.

---

## Bundled Binaries

The packaged app ships several native/prebuilt binaries. `asarUnpack` and `extraResources` in `packages/electron/package.json` (`build` block) control which escape the asar archive — native code **must** be unpacked to be executable.

| Binary package | How obtained | Integrity / verification | Ships how |
|---|---|---|---|
| `@vscode/ripgrep` `1.17.1` | npm tarball + **postinstall downloads the ripgrep binary** from Microsoft's GitHub release CDN | npm tarball: sha512 integrity. Downloaded binary: `@vscode/ripgrep`'s own postinstall verifies a checksum of the fetched archive. | `asarUnpack` (`node_modules/@vscode/ripgrep/**`) + `extraResources` to `app.asar.unpacked/node_modules/@vscode/ripgrep` |
| `node-pty` `1.1.0` | npm tarball + **node-gyp native compile at install** (`postinstall` rebuild via `electron-builder install-app-deps`) | npm tarball sha512 integrity. Compiled locally — no remote binary fetch. | `extraResources` (`../../node_modules/node-pty` → `node-pty`) |
| `electron` `41.0.4` | npm tarball + **postinstall downloads the Electron runtime** from `github.com/electron/electron` releases | electron's `@electron/get` verifies the download against a published SHASUMS file. | The runtime itself |
| `bufferutil`, `utf-8-validate`, `sharp` (`@img`) | npm + native compile / prebuilt platform binary | npm sha512 integrity; `sharp` uses prebuilt `@img/*` packages, also integrity-hashed | `sharp`/`@img` via `extraResources`; `bufferutil`/`utf-8-validate` rebuilt by `install-app-deps` |
| `@openai/codex` / `@openai/codex-sdk` `0.130.0` | npm tarball — **prebuilt binary inside the package, NO install script** | npm sha512 integrity only (the binary is in the published tarball, so the tarball hash covers it) | `build.files` allowlist + `mac.extraResources` (`@openai/codex-darwin-${arch}` → `app.asar.unpacked/...`) |
| `@zed-industries/codex-acp` `0.12.0` | npm tarball — prebuilt binary, **no install script** | npm sha512 integrity (covers the embedded binary) | `build.files` + `mac.extraResources` (`codex-acp-darwin-${arch}`) |
| `@anthropic-ai/claude-agent-sdk` `0.2.126` (+ `-darwin-${arch}`) | npm tarball — prebuilt platform packages, no install script | npm sha512 integrity | `build.files` + `mac.extraResources` (`claude-agent-sdk-darwin-${arch}`); `signIgnore` excludes its vendored `.jar` files from notarization |
| `ghostty-web` `0.4.0` | npm tarball — WASM artifact, **no install script** | npm sha512 integrity | bundled in renderer build |
| `libheif-js` / `heic-decode` | npm tarball — WASM/JS, no install script | npm sha512 integrity | `extraResources` |
| `@electric-sql/pglite` (`pglite.wasm`, `pglite.data`) | npm tarball | npm sha512 integrity | `extraResources` (wasm + data file copied out) |

**Assessment:**
- **Install-time downloads** happen for `@vscode/ripgrep` and `electron` only. Both verify the fetched binary with a checksum (ripgrep) / published SHASUMS (electron-get). This is the standard, accepted model — but it does mean the binary is *not* covered by `package-lock.json` integrity; it depends on the upstream CDN and the package's own verification logic. Acceptable, but worth knowing.
- **The AI-CLI binaries** (`@openai/codex`, `@zed-industries/codex-acp`, `@anthropic-ai/claude-agent-sdk` platform packages) take the *safer* approach: the prebuilt binary is **inside the npm tarball**, so `package-lock.json`'s sha512 integrity hash fully covers it. No install-time fetch, no install script. This is the strongest option.
- `asarUnpack` correctly unpacks everything with a `.node` extension plus the AI-SDK / ripgrep trees — native code cannot run from inside asar, so this is required and correct.
- **Recommendation:** no action needed for the release. For defense-in-depth, consider documenting (in `RELEASING.md`) that `@vscode/ripgrep` and `electron` perform install-time CDN downloads, so a CI environment with `npm ci --ignore-scripts` would silently ship without those binaries — the `electron-builder install-app-deps` postinstall and the ripgrep download must run.

---

## Summary of Actions Before Signed Release

1. **Apply safe bumps 1–7** (`electron@41.6.1` incl. `build.electronVersion`, `mermaid@11.15.0`, `ws@8.20.1`, `express-rate-limit@^8`, `nanoid`, `posthog-js@^1.374`, `elliptic`).
2. **Apply `@anthropic-ai/sdk@^0.97`** and verify the Claude memory tool writes files `0600`.
3. Optionally tackle the breaking majors (`electron-store@10`, `uuid@14`) — `electron-store` requires re-deriving the `build.files` allowlist.
4. Re-run `npm audit` and confirm `peer: true` count stays at 18 in the lockfile diff.
5. Everything else (build-time toolchain, `protobufjs`/otel chain, `fast-uri`/`ajv`, `dompurify`-in-monaco) is **accept/monitor** — not a release blocker, no CRITICALs.
