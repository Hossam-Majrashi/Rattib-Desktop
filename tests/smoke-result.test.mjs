import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smokeFailure, githubError } from '../scripts/smoke-result.mjs';

test('reports native Electron startup failures even without any test-stage output', () => {
  const report = smokeFailure({ status: null, signal: 'SIGTERM', error: { message: 'spawnSync ETIMEDOUT' } });
  assert.equal(report.stage, 'electron-startup');
  assert.equal(report.reason, 'spawnSync ETIMEDOUT');
  assert.equal(report.stdout, '');
});
test('keeps the last stage and bounded diagnostic output on failures', () => {
  const report = smokeFailure({ stdout: 'SMOKE_STAGE backend\r\nSMOKE_STAGE arabic-input\r\n' + 'x'.repeat(7000), stderr: 'Native failure', status: 1 });
  assert.equal(report.stage, 'arabic-input');
  assert.equal(report.stdout.length, 6000);
  assert.equal(report.stderr, 'Native failure');
  assert.match(report.reason, /status 1/);
});
test('GitHub failure annotations escape percent signs and line breaks', () => {
  assert.equal(githubError('100%\r\nfailed'), '::error title=Electron smoke process failed::100%25%0D%0Afailed');
});
