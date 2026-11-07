import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import electron from 'electron';
const profile = mkdtempSync(join(tmpdir(), 'rattib-smoke-'));
let status = 1;
try {
  const child = spawnSync(electron, ['scripts/smoke.cjs'], {
    stdio: 'inherit', timeout: 60000,
    env: { ...process.env, RATTIB_SMOKE_PROFILE: profile }
  });
  if (child.error) console.error(child.error.message);
  status = child.status ?? 1;
} finally {
  // Chromium must have exited before removing its profile.
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exitCode = status;
