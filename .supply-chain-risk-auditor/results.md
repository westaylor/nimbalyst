# Supply Chain Risk Report

---

## Metadata

- **Scan Date**: 2026-05-19 17:30:00
- **Project**: Nimbalyst (monorepo — root + `packages/electron` + `packages/runtime`)
- **Repositories Scanned**: 154 direct dependencies inspected; ~40 flagged
- **Total Dependencies**: 1973 (incl. transitive, per `npm ls`)
- **Scan Duration**: ~13 minutes

---

## Executive Summary

The Nimbalyst dependency tree is healthy at the foundation — the heavyweight runtime is dominated by org-backed projects (Meta/React/Lexical, Electron, Microsoft/VSCode, Mozilla/pdfjs, Anthropic, OpenAI, Stytch, Vite, PostCSS, Tailwind, Yjs, mermaid, etc.). The risk surface concentrates in three buckets: **(1) a small number of long-abandoned runtime deps** that should be replaced or pinned (notably `abort-controller`, `extract-zip`, `ajv-draft-04`, `front-matter`, `html2canvas`); **(2) several AI-protocol-critical packages with low popularity or weak provenance** (`@agentclientprotocol/sdk`, `@zed-industries/codex-acp`, `@opencode-ai/sdk`, `mcp-remote`) — these sit on the trust path between the AI agent and the user's machine and deserve disproportionate scrutiny; and **(3) native / WASM parsers of untrusted binary input** under small-team ownership (`ghostty-web`, `gifuct-js`, `heic-decode`, `bufferutil`, `utf-8-validate`). The single most surprising finding is **`pkce-challenge`** — an anonymous single maintainer (~91 stars) handling OAuth/PKCE crypto for the app's auth flow; PKCE itself is ~20 lines of `node:crypto` and should be inlined.

Across the 40 flagged dependencies the dominant risk factor is the absence of any documented security contact (33 of 40 have no `SECURITY.md`), followed by single-maintainer concentration (35) — these are correlated and largely apply to the same set of small packages. Five runtime deps have been **fully stale for 4+ years**. No flagged dependency is currently archived or explicitly seeking maintainers. Most flags can be remediated by replacing two or three packages and pinning the rest; the executive recommendation list at the end of this report ranks the actions by leverage.

### Counts by Risk Factor

A single dependency may appear in multiple rows.

| Risk Factor | Example Dependencies | Total |
|-------------|----------------------|-------|
| **SM** — Single maintainer / small team | abort-controller, extract-zip, ajv-draft-04, front-matter, html2canvas, @zed-industries/codex-acp, ghostty-web, @opencode-ai/sdk, form-data-encoder, formdata-node, gifuct-js, heic-decode, pkce-challenge, shell-quote, vite-plugin-dts, vite-plugin-node-polyfills, vite-plugin-static-copy, zod-to-json-schema, web-streams-polyfill, mcp-remote, ulid, ignore, qrcode, raw-body, eventsource-parser, react-virtuoso, react-syntax-highlighter, react-error-boundary, virtua, json-schema-to-ts, es-module-shims, chardet, agentkeepalive, eventsource, pathe | **35** |
| **NSC** — No security contact (no SECURITY.md, no security email) | abort-controller, extract-zip, ajv-draft-04, front-matter, html2canvas, ghostty-web, @opencode-ai/sdk, form-data-encoder, formdata-node, gifuct-js, heic-decode, pkce-challenge, vite-plugin-dts, vite-plugin-node-polyfills, vite-plugin-static-copy, zod-to-json-schema, web-streams-polyfill, mcp-remote, ulid, ignore, qrcode, express-rate-limit, eventsource-parser, react-virtuoso, react-syntax-highlighter, virtua, json-schema-to-ts, es-module-shims, bufferutil, utf-8-validate, chardet, agentkeepalive, pathe | **33** |
| **LP** — Low popularity (< ~500 stars for a runtime dep, or <100 for a security-sensitive one) | ajv-draft-04 (~11), @agentclientprotocol/sdk (~179), form-data-encoder (~27), heic-decode (~54), pkce-challenge (~91), shell-quote (~53), vite-plugin-node-polyfills (~420), vite-plugin-static-copy (~422), bufferutil (~168), utf-8-validate (~126) | **10** |
| **HRF** — High-risk features (native code, deserialization, RCE-prone) | extract-zip (zip-slip surface), ghostty-web (WASM VT100 parser), gifuct-js (GIF binary parser), heic-decode (HEIC binary parser), shell-quote (shell injection adjacency), mcp-remote (MITM-style network proxy), es-module-shims (page-load script execution), bufferutil (native node-gyp), utf-8-validate (native node-gyp) | **9** |
| **UM** — Unmaintained (no commits in 18+ months OR archived) | abort-controller (last commit 2019), extract-zip (2021), ajv-draft-04 (2021), front-matter (2021), html2canvas (2022) | **5** |
| **Total flagged** | — | **40** |

### High-Risk Dependencies

Per the skill workflow ("If a dependency satisfies any of the Risk Criteria, add it to the High-Risk Dependencies table"). Sorted by severity (UM-flagged first, then runtime-critical, then build-time).

| Dependency | Risk Factors | Notes | Suggested Alternative |
|------------|--------------|-------|-----------------------|
| **abort-controller** | UM, SM, NSC | ~308 stars; **last commit 2019-03-30** (~7 yrs stale); mysticatea (Toru Nagashima, real identity, ex-ESLint maintainer) authored ~90% | **Drop it.** `AbortController` is built-in to Node ≥ 15 and modern browsers. Remove the polyfill. |
| **extract-zip** | UM, SM, HRF, NSC | ~398 stars; **last commit 2021-08** (~4.5 yrs stale); max-mapper 51% of top-5; ZIP extraction is the H2 zip-slip surface; 57 open issues; no SECURITY.md | **`yauzl`** (battle-tested) or `unzipper`. Or switch to a streaming `node:zlib` + `tar` if you control the format. |
| **ajv-draft-04** | UM, SM, LP, NSC | **~11 stars**; **last commit 2021-05** (~5 yrs stale); epoberezkin (ajv author) 100% | Migrate consumers to JSON Schema Draft 7+ (ajv default) and **drop**, or pin and accept as a frozen shim. |
| **front-matter** | UM, SM, NSC | ~695 stars; **last commit 2021-10** (~4.5 yrs); last npm publish 2020; jxson (Jason Campbell) 88% | **`gray-matter`** (Jon Schlinkert, ~3.6k stars, actively maintained, superset feature-wise). |
| **html2canvas** | UM, SM, NSC | ~31.9k stars (popular but stale); **last commit 2022-01** (~4 yrs); niklasvh 91%; **1,051 open issues** | None ideal; `dom-to-image-more` and `modern-screenshot` exist but are smaller / similarly maintained. Keep, pin, and review releases manually. |
| **pkce-challenge** | SM, LP, NSC | **~91 stars**; crouchcd 79% with an **anonymous identity** (no real name on the GitHub profile); handles OAuth/PKCE crypto material — disproportionate risk for a security-critical dep | **Drop the dep — PKCE is ~20 lines of `node:crypto`** (`randomBytes` + `createHash('sha256')` + base64url). Inline it. |
| **shell-quote** | SM, LP, HRF | **~53 stars**; ljharb 52% (Jordan Harband — famously prolific, lowers SM risk but does not eliminate); shell command quoting → bugs here become RCE | None directly — but **prefer passing argv arrays to `child_process.spawn(cmd, [...args])`** rather than building shell strings at all. |
| **ghostty-web** | SM, NSC, HRF | ~2.4k stars; active (2026-04); sreya 88% (Coder org but small core); **WASM VT100 terminal parser** of untrusted bytes | None — only WASM Ghostty parser. Keep, **sandbox WASM execution**, and pin. |
| **@agentclientprotocol/sdk** | LP | ~179 stars; active (2026-05); org-owned (Zed Industries); drives **agent ↔ editor RPC** — high blast radius | None — reference SDK. **Pin and watch the upstream repo.** |
| **@zed-industries/codex-acp** | SM | ~766 stars; benbrandt 78%; bridges Codex ↔ ACP (RPC) | None — single-source. **Pin.** |
| **@opencode-ai/sdk** | SM, NSC | npm package has **no `repository` field**; only 2 maintainers (adamelmore, thdxr); SST org parent repo healthy | None — first-party SST opencode SDK. **Pin to a known-good version and verify provenance** against `sst/opencode/packages/sdk-js` before each bump. |
| **mcp-remote** | SM, NSC, HRF | ~1.4k stars; geelen (Glen Maddern, real) 84%; **proxies MCP traffic over the network** — trusted MITM position; 116 open issues | None — official MCP transport bridge. **Pin and audit on each bump.** |
| **gifuct-js** | SM, NSC, HRF | ~511 stars; matt-way 68%; **binary GIF parser** of untrusted image bytes | `omggif` (smaller, decode-only) or `gif.js` for encode; for decode, keep gifuct-js but sandbox parsing. |
| **heic-decode** | SM, LP, NSC, HRF | ~54 stars; catdad 97%; **HEIC image decoder** wrapping libheif-derived code | `heic2any` (browser) or `libheif-js` (more complete but also SM). Best long-term: hand HEIC to a native helper. |
| **form-data-encoder** | SM, LP, NSC | ~27 stars; octet-stream (Nick K., real) 97% — **single user maintaining**; no SECURITY.md | Use `undici`'s native `FormData` + `fetch` in Node 18+ where possible. |
| **formdata-node** | SM, NSC | ~146 stars; same single maintainer as form-data-encoder | Same as above — prefer Node 18+ native `FormData`. |
| **es-module-shims** | SM, NSC, HRF | ~1.7k stars; guybedford (Guy Bedford, real, well-known) 95%; **import-map shim runs at page load** — compromise = client-side RCE | None — canonical import maps polyfill. **Subresource-integrity-pin the served file.** |
| **bufferutil** | LP, HRF, NSC | ~168 stars; native node-gyp binding for `ws`; org-backed (websockets/) but tiny core | Optional dep of `ws` — `ws` falls back to pure JS. **Omit from install** unless the perf is needed. |
| **utf-8-validate** | LP, HRF, NSC | ~126 stars; same as bufferutil; native binding | Same — optional dep, safe to omit. |
| **virtua** | SM, NSC | ~3.6k stars; inokawa 93% with an **anonymous handle**; 73 open issues | **`@tanstack/react-virtual`** (TanStack org, healthier maintainer pool). |
| **vite-plugin-dts** | SM, NSC | ~1.5k stars; qmhc 98% with an **anonymous handle**; runs at build time (build-time RCE if compromised) | Replace with a `tsc --emitDeclarationOnly` step. |
| **vite-plugin-node-polyfills** | SM, LP, NSC | ~420 stars; davidmyersdev 94%; build-time code injection path | Hand-pick `resolve.alias` entries for specific polyfills (`buffer`, `process`) and drop the plugin. |
| **vite-plugin-static-copy** | SM, LP, NSC | ~422 stars; sapphi-red 80% with an **anonymous handle** | Use Vite's built-in `publicDir`; only keep this if you need glob-based copies. |
| **zod-to-json-schema** | SM, NSC | ~1.3k stars; StefanTerdell 65% (real); **officially superseded** by `zod/v4` `.toJSONSchema()` | Migrate to **Zod v4's built-in `z.toJSONSchema()`** once on Zod ≥ 4. |
| **web-streams-polyfill** | SM, NSC | ~333 stars; MattiasBuelens 91% (WHATWG Streams editor — reputable) | **Drop** if your minimum Node is 18+ (native `ReadableStream`/`WritableStream`). |
| **react-syntax-highlighter** | SM, NSC | ~4.7k stars; conorhastings 57% (real); 138 open issues | **`shiki`** (Anthony Fu / VueJS team, ~10k stars, more active) is the modern replacement. |
| **react-virtuoso** | SM, NSC | ~6.3k stars; petyosi (Petyo Ivanov, real; has a commercial product around this) 88% | `react-window` (Brian Vaughn) or `@tanstack/react-virtual`. |
| **react-error-boundary** | SM | ~7.9k stars; bvaughn (Brian Vaughn — ex-React core, prolific) 75% | None — keep; reputable maintainer. |
| **ulid** | SM, NSC | ~3.4k stars; alizain 72%; last commit 2025-11; cryptographic-ish (sortable random IDs) | **`ulidx`** (TypeScript-first fork, more active), or `crypto.randomUUID()` if sortable IDs aren't required. |
| **ignore** | SM, NSC | ~496 stars (just under threshold); kaelzhang 94% (real) | `gitignore-parser`, or rely on `globby`/`tinyglobby`'s native `.gitignore` support. |
| **qrcode** | SM, NSC | ~8k stars; soldair (Ryan Day, real) 68%; **last commit 2024-08** (~9 mo, borderline); 123 open issues | `qr-code-styling` (browser) or `qrcode-generator` (smaller). |
| **eventsource-parser** | SM, NSC | ~483 stars; rexxars (Espen Hovlandsdal, Sanity) 83% | Native `ReadableStream` + manual SSE parsing is ~30 lines if you control both ends. |
| **eventsource** | SM | ~1.1k stars; aslakhellesoy (Aslak Hellesøy, Cucumber author) 48%; has SECURITY.md | **None — keep.** Reputable maintainer. |
| **json-schema-to-ts** | SM, NSC | ~1.8k stars; ThomasAribart (real) 76% | `ts-json-schema-generator` or `quicktype` for build-time generation. |
| **express-rate-limit** | NSC | ~3.3k stars; org-owned but small core; no SECURITY.md | None directly comparable. **Keep but pin.** |
| **raw-body** | SM | ~400 stars; dougwilson (Express team — well-known) 85%; HAS SECURITY.md; flagged only for solo-maintainer signal on a body parser | **None — keep.** Express ecosystem owner. |
| **agentkeepalive** | SM, NSC | ~604 stars; fengmk2 (Yiyu He — well-known Node maintainer) 94% | **Drop if possible** — Node 18+ ships keepAlive by default on `http.Agent`. |
| **chardet** | SM, NSC | ~303 stars; runk (Dmitry Shirokov, real) 61%; character-set detection on untrusted input | `jschardet` (older but more mature). |
| **pathe** | SM, NSC | ~579 stars; renovate-bot dominates contributor activity; org-owned (unjs); human concentration unclear | Use `node:path` directly and normalize separators if cross-platform needs demand it. **Drop if practical.** |

## Suggested Alternatives

Consolidated by leverage — applying these in order eliminates the most risk for the least effort.

1. **Drop polyfills already in the runtime:**
   - `abort-controller` → remove (built-in in Node 15+).
   - `web-streams-polyfill` → remove if minimum Node is 18+.
   - `agentkeepalive` → swap for `new http.Agent({ keepAlive: true })`.
   - `pkce-challenge` → inline ~20 lines of `node:crypto`. Highest-leverage move; removes an anonymous-maintainer dep from the auth path.
2. **Replace with healthier equivalents:**
   - `extract-zip` → `yauzl`.
   - `front-matter` → `gray-matter`.
   - `react-syntax-highlighter` → `shiki`.
   - `react-virtuoso` / `virtua` → `@tanstack/react-virtual`.
   - `zod-to-json-schema` → built-in `z.toJSONSchema()` after the Zod v4 migration completes.
3. **Replace build-time plugins with first-party Vite features:**
   - `vite-plugin-dts` → separate `tsc --emitDeclarationOnly` step.
   - `vite-plugin-static-copy` → Vite's `publicDir`.
   - `vite-plugin-node-polyfills` → hand-pick `resolve.alias` per polyfill needed.
4. **Pin and watch (no good alternative exists):**
   - The AI-protocol set — `@agentclientprotocol/sdk`, `@zed-industries/codex-acp`, `@opencode-ai/sdk`, `mcp-remote`. These are first-party SDKs from the respective vendors. Keep tilde-pinned, review every minor bump, and verify provenance from the upstream monorepo for `@opencode-ai/sdk` (which has no `repository` field in npm metadata).
   - `ghostty-web`, `gifuct-js`, `heic-decode` — keep but ensure parsing runs in a sandboxed/isolated context (already the case for the WASM ones).
   - `html2canvas` — pin and review releases; no equivalent exists.
   - `es-module-shims` — pin and consider SRI-pinning the served file.
5. **Drop the optional native bindings (`bufferutil`, `utf-8-validate`)** unless the `ws` perf boost is measured to matter — they are pure-JS-fallback'd.

## Report Generated By

Supply Chain Risk Auditor Skill
Generated: 2026-05-19 17:30:00
