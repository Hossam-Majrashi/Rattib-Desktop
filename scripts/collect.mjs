import { readFile, readdir, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyArchPackage } from './verify-arch.mjs';
const [kind, arch] = process.argv.slice(2);
const os = kind === 'flatpak' || kind === 'arch' ? 'linux' : kind;
if (!['linux', 'arch', 'flatpak', 'macos', 'windows'].includes(kind) || !['x64', 'arm64', 'universal'].includes(arch) || (arch === 'universal' && kind !== 'macos')) throw new Error('Invalid build target.');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const normalizedArch = arch === 'x64' && os !== 'windows' ? 'x86_64' : arch === 'arm64' && os === 'linux' ? 'aarch64' : arch;
const aliases = os === 'linux' ? (arch === 'x64' ? ['x64', 'x86_64', 'amd64'] : ['arm64', 'aarch64']) : os === 'macos' && arch === 'x64' ? ['x64', 'x86_64'] : [arch];
const prefixes = aliases.map(alias => `Rattib-Desktop-${version}-${os}-${alias}`);
const normalizedPrefix = `Rattib-Desktop-${version}-${os}-${normalizedArch}`;
const suffixes = kind === 'linux' ? ['.AppImage', '.deb', '.rpm', '.tar.gz']
  : kind === 'arch' ? ['.pkg.tar.zst'] : kind === 'flatpak' ? ['.flatpak'] : kind === 'macos' ? ['.dmg'] : ['.msi', '-setup.exe', '-portable.zip'];
await mkdir('artifacts', { recursive: true });
const existing = new Set(await readdir('release'));
const files = [];
for (const suffix of suffixes) {
  const candidates = prefixes.map(prefix => prefix + suffix).filter(name => existing.has(name));
  if (candidates.length !== 1) throw new Error('Missing or ambiguous package: ' + normalizedPrefix + suffix);
  const name = candidates[0];
  const output = normalizedPrefix + suffix;
  const file = join('artifacts', output);
  await copyFile(join('release', name), file);
  if (suffix === '.pkg.tar.zst') await verifyArchPackage(file, arch, version);
  if (suffix === '.AppImage') {
    // External zsync URL; this is not an implementation of in-app self-updating.
    const url = `https://github.com/Hossam-Majrashi/Rattib-Desktop/releases/download/v${version}/${output}`;
    execFileSync('zsyncmake', ['-u', url, '-o', file + '.zsync', file], { stdio: 'inherit' });
    files.push(output + '.zsync');
  }
  files.push(output);
}
const sums = [];
for (const name of files.sort()) sums.push(createHash('sha256').update(await readFile(join('artifacts', name))).digest('hex') + '  ' + name);
await writeFile(join('artifacts', `SHA256SUMS-${kind}-${normalizedArch}.txt`), sums.join('\n') + '\n');
console.log('Collected verified file set:', files);
