import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import electron from 'electron';
import { smokeFailure, githubError } from './smoke-result.mjs';
const profile = mkdtempSync(join(tmpdir(), 'rattib-smoke-'));
let status = 1;
try {
  const args = process.platform === 'linux' ? ['--ozone-platform=headless', 'scripts/smoke.cjs'] : ['scripts/smoke.cjs'];
  const child = spawnSync(electron, args, {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 90000,
    env: { ...process.env, RATTIB_SMOKE_PROFILE: profile }
  });
  process.stdout.write(child.stdout ?? '');
  process.stderr.write(child.stderr ?? '');
  status = child.status ?? 1;
  if (status !== 0) {
    const report = smokeFailure(child);
    console.error('SMOKE_PROCESS_FAILURE ' + JSON.stringify(report));
    if (process.env.RATTIB_SMOKE_REPORT_DIR) {
      mkdirSync(process.env.RATTIB_SMOKE_REPORT_DIR, { recursive: true });
      writeFileSync(join(process.env.RATTIB_SMOKE_REPORT_DIR, 'process-failure.json'), JSON.stringify(report, null, 2));
    }
    if (process.env.GITHUB_ACTIONS === 'true') console.error(githubError(JSON.stringify(report)));
  }
} finally {
  // Chromium must have exited before removing its profile.
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exitCode = status;
