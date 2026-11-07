import { access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function universalChecks(appDirectory) {
  return [
    join(appDirectory, 'Contents', 'MacOS', 'Rattib Desktop'),
    join(appDirectory, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'build', 'Release', 'pty.node')
  ].map(file => ({ file, args: [file, '-verify_arch', 'x86_64', 'arm64'] }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.platform !== 'darwin') throw new Error('Universal verification requires macOS lipo.');
  for (const { file, args } of universalChecks(process.argv[2] || 'release/mac-universal/Rattib Desktop.app')) {
    await access(file);
    // lipo consumes all arguments after -verify_arch as architectures: input MUST be first.
    execFileSync('lipo', args, { stdio: 'inherit' });
    execFileSync('lipo', [file, '-archs'], { stdio: 'inherit' });
  }
  console.log('UNIVERSAL_OK executable + native PTY: x86_64 and arm64');
}
