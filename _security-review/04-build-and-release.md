# Build & Signing — macOS Signed Distribution

This document records how the macOS build is produced and code-signed for
Nimbalyst, as exercised during the 2026-05-19 security review.

## Signing identity

Nimbalyst is a first-party WijMir LLC product. The macOS distribution
build is signed with the company's Apple Developer ID:

```
Developer ID Application: WijMir LLC (AZX236YXRK)
```

Confirm it is present in the login keychain before building:

```sh
security find-identity -v -p codesigning
# Expect a line:  Developer ID Application: WijMir LLC (AZX236YXRK)
```

`Developer ID Application` (not `Apple Development`) is the certificate
type required for distributing a binary that runs on Macs other than the
build machine and passes Gatekeeper.

## How the build wiring works

The build is driven from `packages/electron`:

| Script | Effect |
|---|---|
| `build:mac:local` | `SKIP_NOTARIZE=true` — signed, hardened-runtime, **not** notarized, `--publish never` |
| `build:mac` / `build:mac:signed` | signed; notarizes if `.env` has Apple ID credentials |
| `build:mac:notarized` | `REQUIRE_NOTARIZE=true` — fails the build if notarization can't run |
| `build:mac:release` | notarized **and** `--publish always` (uploads to the GitHub release) |

Three build scripts cooperate:

- **`build/configure-build.js`** — inspects the environment and mutates
  `packages/electron/package.json` `build.mac`. When signing is possible
  (`CSC_IDENTITY_AUTO_DISCOVERY` is not `'false'`) it enables
  `hardenedRuntime: true` and points at `build/entitlements.mac.plist`.
  When `SKIP_NOTARIZE=true` it sets `build.mac.notarize = false`.
- **`build/build-with-env.js`** — loads `.env`, then invokes
  `electron-builder`.
- **`build/afterSign.js`** — runs as electron-builder's `afterSign` hook:
  strips un-notarizable `.jar` files from the bundled Claude Agent SDK
  vendor directory, signs the bundled `ripgrep` binary with the hardened
  runtime, then **deep re-signs the whole `.app`**. The signing identity
  it uses is `process.env.CSC_NAME` (falling back to the generic string
  `"Developer ID Application"`).

Because `afterSign.js` and electron-builder both honor `CSC_NAME`,
exporting it to the full WijMir identity string pins signing to the
correct certificate even though three code-signing identities exist in
the keychain.

## Build command used for this review

A signed, hardened-runtime, non-notarized, non-published build:

```sh
cd packages/electron
CSC_NAME="Developer ID Application: WijMir LLC (AZX236YXRK)" \
CSC_IDENTITY_AUTO_DISCOVERY=true \
npm run build:mac:local
```

`build:mac:local` was chosen deliberately for the review:

- It **signs** with the WijMir Developer ID and applies the hardened
  runtime — the "build and sign" deliverable.
- It does **not notarize** — notarization requires Apple ID
  app-specific-password credentials and is a separate Apple-server step.
- It does **not publish** — `--publish never` means nothing is uploaded
  to the GitHub release. Publishing is an explicit, separate action.

## Promoting to a notarized, published release

When shipping to users, notarize and publish. Notarization needs Apple ID
credentials, supplied via `packages/electron/.env` (git-ignored):

```sh
# packages/electron/.env
APPLE_ID=<apple-id-email>
APPLE_APP_SPECIFIC_PASSWORD=<app-specific-password>   # appleid.apple.com
APPLE_TEAM_ID=AZX236YXRK
```

Then:

```sh
cd packages/electron
CSC_NAME="Developer ID Application: WijMir LLC (AZX236YXRK)" \
npm run build:mac:notarized        # signed + notarized, no publish
# or
npm run build:mac:release          # signed + notarized + publish to GitHub
```

`build/notarize.js` runs as part of the `afterSign` hook and submits the
app to Apple's `notarytool`. An un-notarized signed app still shows the
Gatekeeper "unidentified developer" prompt on first launch on other Macs.

Do **not** put the Developer ID certificate or Apple ID password into CI
secrets — sign on a machine where the cert already lives in the keychain.
The certificate is what attests "this binary came from WijMir LLC"; if it
leaks, anyone can sign software Gatekeeper trusts as WijMir.

## Verifying a signed build

```sh
APP="release/mac-arm64/Nimbalyst.app"   # adjust arch/path

# Signature is valid and from WijMir:
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dvvv "$APP" 2>&1 | grep -E 'Authority|TeamIdentifier|Identifier'
#   Authority=Developer ID Application: WijMir LLC (AZX236YXRK)
#   TeamIdentifier=AZX236YXRK

# Gatekeeper assessment (will report "rejected" / source=no usable
# signature if NOT notarized — expected for build:mac:local):
spctl --assess --type execute --verbose=4 "$APP"
```

A `build:mac:local` artifact is correctly signed but not notarized, so
`spctl --assess` reports it as not accepted — that is expected. A
`build:mac:notarized` artifact passes `spctl` cleanly.

## Build result — 2026-05-19 review build

`npm run build:mac:local` with `CSC_NAME="WijMir LLC (AZX236YXRK)"`
(note: electron-builder requires the `CSC_NAME` value **without** the
`Developer ID Application: ` prefix — it rejects the prefixed form).

Artifacts produced in `packages/electron/release/`:

- `Nimbalyst-macOS-arm64.dmg` (~362 MB) + `.blockmap`
- `Nimbalyst-macOS.dmg` (backwards-compatible copy)
- `mac-arm64/Nimbalyst.app`
- `latest-mac.yml` (electron-updater feed)

Signature verification:

```
codesign --verify --deep --strict  →  valid on disk;
                                       satisfies its Designated Requirement
codesign -dvvv:
  Authority=Developer ID Application: WijMir LLC (AZX236YXRK)
  Authority=Developer ID Certification Authority
  Authority=Apple Root CA
  TeamIdentifier=AZX236YXRK
  CodeDirectory flags=0x10000(runtime)   ← hardened runtime enabled
  Timestamp=May 19, 2026 (secure timestamp present)
spctl --assess --type execute  →  rejected, source=Unnotarized Developer ID
```

The `spctl` rejection is **expected**: `build:mac:local` produces a
correctly signed, hardened-runtime build but does not notarize it.
Gatekeeper rejects un-notarized apps on first launch on other Macs. To
ship to users, run `build:mac:notarized` with the Apple ID credentials in
`packages/electron/.env` (see above).

Build prerequisites (a fresh checkout needs these before `build:mac:local`
will succeed — each failure cost a build iteration during this review):

1. `npm install` at the repo root.
2. `npm run build --prefix packages/extension-sdk` — produces its `dist/`.
3. `npm run build --prefix packages/runtime` — produces its `dist/`
   (the bundled extensions resolve `@nimbalyst/runtime` as a package).
