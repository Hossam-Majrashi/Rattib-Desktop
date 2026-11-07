import { open } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validatePkgInfo(text, arch, version) {
  const fields = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const match = /^([a-z][a-z0-9_]*) = (.*)$/.exec(line);
    if (!match) throw new Error('Malformed .PKGINFO line: ' + line);
    fields.set(match[1], [...(fields.get(match[1]) ?? []), match[2]]);
  }
  const one = key => {
    const values = fields.get(key);
    if (values?.length !== 1 || !values[0].trim()) throw new Error('Missing, empty, or repeated .PKGINFO field: ' + key);
    return values[0];
  };
  const expected = { x64: 'x86_64', arm64: 'aarch64' }[arch];
  if (!expected) throw new Error('Unsupported Arch package architecture.');
  if (one('pkgname') !== 'rattib-desktop') throw new Error('Unexpected Arch package name.');
  const actualVersion = one('pkgver');
  if (actualVersion !== version && !(actualVersion.startsWith(version + '-') && /^\d+$/.test(actualVersion.slice(version.length + 1)))) throw new Error('Arch package version mismatch.');
  if (one('arch') !== expected) throw new Error('Arch package architecture mismatch.');
  one('pkgdesc');
  return { name: one('pkgname'), version: actualVersion, arch: expected };
}

function extractHeader(file, entry) {
  return new Promise((resolveHeader, reject) => {
    const child = spawn('bsdtar', ['-xOf', file, entry], { stdio: ['ignore', 'pipe', 'pipe'] });
    let header = Buffer.alloc(0);
    let error = '';
    child.stdout.on('data', chunk => {
      if (header.length < 20) header = Buffer.concat([header, chunk.subarray(0, 20 - header.length)]);
      // Drain the rest without retaining a large Electron executable in memory.
    });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-8192); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveHeader(header) : reject(new Error('Could not read packaged executable: ' + error)));
  });
}

export async function verifyArchPackage(file, arch, version) {
  const handle = await open(file, 'r');
  const magic = Buffer.alloc(4);
  try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
  if (magic.toString('hex') !== '28b52ffd') throw new Error('Arch package is not actually zstd-compressed.');
  execFileSync('zstd', ['--test', '--quiet', file], { stdio: 'inherit' });
  const entries = execFileSync('bsdtar', ['-tf', file], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim().split('\n');
  const originals = new Map(entries.map(entry => [entry.replace(/^\.\//, ''), entry]));
  const required = ['.PKGINFO', '.MTREE', '.INSTALL', 'opt/Rattib Desktop/rattib-desktop', 'opt/Rattib Desktop/resources/app.asar', 'usr/share/applications/io.github.HossamMajrashi.RattibDesktop.desktop'];
  for (const size of [48, 128, 256, 512]) required.push(`usr/share/icons/hicolor/${size}x${size}/apps/rattib-desktop.png`);
  for (const entry of required) if (!originals.has(entry)) throw new Error('Missing Arch package payload: ' + entry);
  const desktop = execFileSync('bsdtar', ['-xOf', file, originals.get('usr/share/applications/io.github.HossamMajrashi.RattibDesktop.desktop')], { encoding: 'utf8' });
  if (!/^Icon=rattib-desktop\r?$/m.test(desktop) || !/^StartupWMClass=io\.github\.HossamMajrashi\.RattibDesktop\r?$/m.test(desktop)) throw new Error('Desktop icon/window identity mismatch.');
  const info = validatePkgInfo(execFileSync('bsdtar', ['-xOf', file, originals.get('.PKGINFO')], { encoding: 'utf8', maxBuffer: 262144 }), arch, version);
  const header = await extractHeader(file, originals.get('opt/Rattib Desktop/rattib-desktop'));
  if (header.length < 20 || header.subarray(0, 4).toString('hex') !== '7f454c46' || header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== (arch === 'x64' ? 62 : 183)) throw new Error('Packaged Electron executable architecture mismatch.');
  console.log('ARCH_PACKAGE_OK', JSON.stringify(info));
  return info;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [file, arch, version] = process.argv.slice(2);
  if (!file || !arch || !version) throw new Error('Usage: node scripts/verify-arch.mjs package.pkg.tar.zst x64|arm64 version');
  await verifyArchPackage(file, arch, version);
}
