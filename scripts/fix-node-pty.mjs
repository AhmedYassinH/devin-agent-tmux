#!/usr/bin/env node
/**
 * npm strips the executable bit when it packs node-pty's prebuilds, so the
 * `spawn-helper` binary arrives at 644 and every PTY spawn fails with the
 * unhelpful `posix_spawnp failed`. Restore it after install.
 *
 * Silent no-op on platforms/layouts that don't have the file (Windows uses
 * conpty, and a source build puts it under build/Release instead).
 */
import { chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const candidates = [
  'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
  'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper',
  'node_modules/node-pty/prebuilds/linux-x64/spawn-helper',
  'node_modules/node-pty/prebuilds/linux-arm64/spawn-helper',
  'node_modules/node-pty/build/Release/spawn-helper',
];

for (const rel of candidates) {
  const path = join(process.cwd(), rel);
  if (!existsSync(path)) continue;
  try {
    chmodSync(path, 0o755);
    console.log(`[node-pty] made ${rel} executable`);
  } catch (err) {
    console.warn(`[node-pty] could not chmod ${rel}:`, err.message);
  }
}
