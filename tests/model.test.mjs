import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTools, blankProfile, extractVersion, compareVersions } from '../src/shared/model.ts';
import { shellCommand } from '../src/main/shell.ts';
const tool = () => ({ id: 'test-tool', name: ' Test ', profiles: { linux: blankProfile() } });
test('manual empty inventory is valid', () => assert.deepEqual(validateTools([]), []));
test('normalizes names and preserves exact commands', () => {
  const t = tool(); t.profiles.linux.commands.install = 'curl https://example.invalid/install | sh';
  const [saved] = validateTools([t]); assert.equal(saved.name, 'Test');
  assert.equal(saved.profiles.linux.commands.install, t.profiles.linux.commands.install);
});
test('rejects duplicate IDs', () => assert.throws(() => validateTools([tool(), tool()])));
test('rejects malformed profiles, paths, and commands', () => {
  for (const t of [{ ...tool(), id: '../config' }, { ...tool(), name: '' }, { ...tool(), profiles: { unix: blankProfile() } }]) assert.throws(() => validateTools([t]));
  const t = tool(); t.profiles.linux.commands.update = 'bad\0command'; assert.throws(() => validateTools([t]));
});
test('rejects oversized commands and inventories', () => {
  const t = tool(); t.profiles.linux.commands.install = 'x'.repeat(16385); assert.throws(() => validateTools([t]));
  assert.throws(() => validateTools(Array(501).fill(tool())));
});
test('does not permit Windows shells on Linux or POSIX shells directly on Windows', () => {
  const t = tool(); t.profiles.linux.shell = 'wsl'; assert.throws(() => validateTools([t]));
  assert.throws(() => validateTools([{ ...tool(), profiles: { win32: { ...blankProfile(), shell: 'bash' } } }]));
});
test('extracts an unambiguous version with ANSI colors', () => {
  assert.equal(extractVersion('\x1b[32mPi v1.5.0\x1b[0m\r\n'), '1.5.0');
  assert.equal(extractVersion('v2.0.0-beta.1+build.5'), '2.0.0-beta.1+build.5');
  assert.equal(extractVersion('1.5.0\n1.5.0'), '1.5.0');
});
test('does not guess from ambiguous logs, errors, or two-part versions', () => {
  assert.equal(extractVersion('current 1.0.0 latest 2.0.0'), null);
  assert.equal(extractVersion('not installed'), null);
  assert.equal(extractVersion('1.5'), null);
});
test('compares stable versions numerically, not lexically', () => {
  assert.equal(compareVersions('1.9.0', '1.10.0'), 'available');
  assert.equal(compareVersions('2.0.0', '1.9.0'), 'installed-newer');
  assert.equal(compareVersions('1.0.0', '1.0.0'), 'equal');
  assert.equal(compareVersions(undefined, '1.0.0'), 'unknown');
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), 'manual');
});
test('passes a pipeline as a single explicit shell argument', () => {
  const command = 'curl -fsSL https://example.invalid/install | sh';
  assert.deepEqual(shellCommand('linux', blankProfile(), command, { SHELL: '/bin/bash' }), { file: '/bin/bash', args: ['-lc', command] });
});
test('Windows auto uses PowerShell and WSL is explicit', () => {
  assert.equal(shellCommand('win32', blankProfile(), 'tool -v', {}).file, 'powershell.exe');
  assert.deepEqual(shellCommand('win32', { ...blankProfile(), shell: 'wsl' }, 'tool -v', {}), { file: 'wsl.exe', args: ['--', 'bash', '-lc', 'tool -v'] });
});
test('Flatpak explicitly executes on the host', () => {
  assert.deepEqual(shellCommand('linux', { ...blankProfile(), shell: 'bash' }, 'tool -v', { FLATPAK_ID: 'test' }), { file: 'flatpak-spawn', args: ['--host', '/bin/bash', '-lc', 'tool -v'] });
});
