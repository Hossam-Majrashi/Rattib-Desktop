import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { validatePkgInfo } from '../scripts/verify-arch.mjs';
import { universalChecks } from '../scripts/verify-universal.mjs';
const require = createRequire(import.meta.url);
const pkginfo = (arch = 'x86_64', version = '0.1.2-1') => `# Generated package\npkgname = rattib-desktop\npkgver = ${version}\npkgdesc = Interactive CLI tool manager\narch = ${arch}\ndepend = gtk3\ndepend = nss\n`;

test('Arch metadata uses real target architecture and package version', () => {
  assert.deepEqual(validatePkgInfo(pkginfo(), 'x64', '0.1.2'), { name: 'rattib-desktop', version: '0.1.2-1', arch: 'x86_64' });
  assert.equal(validatePkgInfo(pkginfo('aarch64'), 'arm64', '0.1.2').arch, 'aarch64');
});
test('rejects mislabeled architectures and stale package versions', () => {
  assert.throws(() => validatePkgInfo(pkginfo('amd64'), 'x64', '0.1.2'));
  assert.throws(() => validatePkgInfo(pkginfo('x86_64'), 'arm64', '0.1.2'));
  assert.throws(() => validatePkgInfo(pkginfo('x86_64', '0.1.1-1'), 'x64', '0.1.2'));
});
test('rejects broken multiline or empty .PKGINFO descriptions', () => {
  assert.throws(() => validatePkgInfo(pkginfo().replace('pkgdesc = Interactive CLI tool manager', 'pkgdesc = \n A multiline description'), 'x64', '0.1.2'));
  assert.throws(() => validatePkgInfo(pkginfo().replace('pkgdesc = Interactive CLI tool manager', 'pkgdesc = '), 'x64', '0.1.2'));
});
test('rejects duplicate package identity fields', () => {
  assert.throws(() => validatePkgInfo(pkginfo() + 'arch = x86_64\n', 'x64', '0.1.2'));
});
test('lipo receives the input file before the variable-length architecture flags', () => {
  const checks = universalChecks('app with spaces.app');
  assert.equal(checks.length, 2);
  for (const check of checks) assert.deepEqual(check.args, [check.file, '-verify_arch', 'x86_64', 'arm64']);
  assert.ok(checks[0].file.endsWith('Rattib Desktop'));
  assert.ok(checks[1].file.endsWith('pty.node'));
});
test('Arch target remains zstd and passes a single-line description to FPM', () => {
  const config = require('../electron-builder.cjs');
  assert.equal(config.pacman.compression, 'zstd');
  assert.equal(config.pacman.fpm[0], '--description');
  assert.ok(config.pacman.fpm[1].trim());
  assert.ok(!config.pacman.fpm[1].includes('\n'));
});
test('Arch CI explicitly installs bsdtar and has its own artifact upload', () => {
  const workflow = readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const job = workflow.split('  archlinux:\n')[1]?.split('  flatpak:\n')[0];
  assert.ok(job, 'Dedicated Arch job must exist.');
  assert.match(job, /apt-get install -y [^\n]*libarchive-tools/);
  assert.match(job, /command -v bsdtar/);
  assert.match(job, /node scripts\/collect\.mjs arch/);
  assert.match(job, /packages-arch-/);
  assert.match(job, /bash scripts\/test-arch-install\.sh/);
});
test('Linux launcher ships real standard-size icons, not only a 1024px image', () => {
  assert.equal(require('../electron-builder.cjs').linux.icon, 'assets/icons');
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    const image = readFileSync(new URL('../assets/icons/' + size + 'x' + size + '.png', import.meta.url));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(image.readUInt32BE(16), size);
    assert.equal(image.readUInt32BE(20), size);
  }
});
test('Arch install check resolves dependencies instead of bypassing them', () => {
  const script = readFileSync(new URL('../scripts/test-arch-install.sh', import.meta.url), 'utf8');
  assert.match(script, /pacman -Syu --noconfirm/);
  assert.match(script, /pacman -U --noconfirm/);
  assert.doesNotMatch(script, /--nodeps|--dbonly|--noscriptlet/);
});
