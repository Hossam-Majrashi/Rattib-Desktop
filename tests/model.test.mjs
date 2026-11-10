import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTools, blankProfile, commandIssue, extractVersion, compareVersions, toolActions, commandExamples } from '../src/shared/model.ts';
import { shellCommand } from '../src/main/shell.ts';
import { strataVersion, strataUpdatedVersion, hermesVersion } from './version-output.mjs';
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
test('version, latest-source and updater commands have distinct roles', () => {
  const profile = blankProfile();
  assert.equal(commandIssue(profile, 'update'), 'errorCommand');
  profile.commands.update = 'pi update';
  assert.equal(commandIssue(profile, 'update'), 'versionRequired');
  profile.commands.version = 'pi -v';
  assert.equal(commandIssue(profile, 'version'), null);
  assert.equal(commandIssue(profile, 'update'), null);
  profile.commands.update = '  pi -v\n';
  profile.commands.latest = 'pi -v';
  assert.equal(commandIssue(profile, 'update'), 'updateMatchesVersion');
  assert.equal(commandIssue(profile, 'latest'), 'latestMatchesVersion');
  profile.commands.latest = 'fetch-latest-release';
  assert.equal(commandIssue(profile, 'latest'), null);
  assert.equal(commandIssue(undefined, 'version'), 'errorCommand');
});
test('all visible command fields have illustrative placeholders, without a release-check action', () => {
  assert.deepEqual(toolActions, ['install', 'launch', 'version', 'update', 'uninstall']);
  for (const action of toolActions) {
    assert.ok(commandExamples[action].trim());
    assert.equal(blankProfile().commands[action], '');
  }
  assert.equal(commandExamples.update, 'strata update');
  assert.equal(commandExamples.version, 'strata --version');
});
test('extracts an unambiguous version with ANSI colors', () => {
  assert.equal(extractVersion('\x1b[32mPi v1.5.0\x1b[0m\r\n'), '1.5.0');
  assert.equal(extractVersion('v2.0.0-beta.1+build.5'), '2.0.0-beta.1+build.5');
  assert.equal(extractVersion('1.5.0\n1.5.0'), '1.5.0');
});
test('reads product headers without mistaking build, Python or SDK versions for the tool', () => {
  assert.equal(extractVersion(strataVersion), '0.2.12');
  assert.equal(extractVersion(hermesVersion), '0.23.1');
  assert.equal(extractVersion(strataUpdatedVersion), '0.2.13.1');
  assert.equal(extractVersion('v1.2.3.4'), '1.2.3.4');
  assert.equal(extractVersion('\x1b[32m' + strataVersion + '\x1b[0m\r\n'), '0.2.12');
  assert.equal(extractVersion('\r\n' + hermesVersion.replaceAll('\n', '\r\n')), '0.23.1');
  assert.equal(extractVersion('Example CLI version: 1.2.3-beta.1+build.5\nPython: 3.12.0'), '1.2.3-beta.1+build.5');
  assert.equal(extractVersion('Example CLI v1.2.3 · stable\nSDK: 4.5.6'), '1.2.3');
});
test('does not guess from ambiguous logs, errors, or two-part versions', () => {
  assert.equal(extractVersion('current 1.0.0 latest 2.0.0'), null);
  assert.equal(extractVersion('not installed'), null);
  assert.equal(extractVersion('1.5'), null);
  assert.equal(extractVersion('1.2.3.4.5'), null);
  assert.equal(extractVersion('tool 1.2.3.4 dependency 2.3.4.5'), null);
  assert.equal(extractVersion('current 1.0.0 (latest 2.0.0)'), null);
  assert.equal(extractVersion('Error v1.0.0\nExpected 2.0.0'), null);
  assert.equal(extractVersion('tool 1.5.0 dependency 2.0.0'), null);
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
