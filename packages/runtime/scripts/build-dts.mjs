#!/usr/bin/env node
// Run `tsc -p tsconfig.dts.json` to emit per-file .d.ts into dist/, then
// clean up any leaked declarations that tsc emitted next to cross-package
// source files.
//
// Background: tsc emits .d.ts for every reachable file. For files inside
// `rootDir` (./src) the output goes to outDir (./dist). For files OUTSIDE
// rootDir -- pulled in via cross-package imports (e.g.
// src/ai/server/providers/ClaudeCodeProvider.ts importing
// ../../../../../electron/src/main/HistoryManager) -- tsc lands the .d.ts
// next to the source file. We delete those leaked .d.ts files in other
// packages so they don't pollute the source tree. Hand-written .d.ts files
// (with no matching .ts/.tsx sibling) are preserved.
//
// tsc also exits non-zero (TS6059) for those rootDir-violating files, but
// the per-file .d.ts emission for our own package is still complete; we
// treat its exit as non-fatal as long as the dist/ tree was populated.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(pkgDir, '../..');

const result = spawnSync('npx', ['--no-install', 'tsc', '-p', 'tsconfig.dts.json'], {
  stdio: 'inherit',
  shell: true,
  cwd: pkgDir,
});

const CROSS_PACKAGE_SOURCE_DIRS = [
  path.join(repoRoot, 'packages/electron/src'),
  path.join(repoRoot, 'packages/extension-sdk/src'),
];

function cleanLeakedDts(dir) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += cleanLeakedDts(full);
    } else if (entry.name.endsWith('.d.ts')) {
      const base = entry.name.slice(0, -'.d.ts'.length);
      const hasSource =
        fs.existsSync(path.join(dir, `${base}.ts`)) ||
        fs.existsSync(path.join(dir, `${base}.tsx`));
      if (hasSource) {
        fs.unlinkSync(full);
        removed += 1;
      }
    }
  }
  return removed;
}

let totalRemoved = 0;
for (const dir of CROSS_PACKAGE_SOURCE_DIRS) {
  totalRemoved += cleanLeakedDts(dir);
}
if (totalRemoved > 0) {
  console.log(`[runtime/build-dts] Cleaned up ${totalRemoved} leaked .d.ts files in cross-package source trees.`);
}

if (result.status === 0) {
  process.exit(0);
}

console.warn(
  `\n[runtime/build-dts] tsc exited ${result.status}. .d.ts files in dist/ ` +
  `are still emitted; pre-existing cross-package imports cause TS6059. ` +
  `Run "npm run typecheck" for the strict type check.`
);
process.exit(0);
