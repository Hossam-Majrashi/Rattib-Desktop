import type { Platform, Profile } from '../shared/model';
export function shellCommand(platform: Platform, profile: Profile, command: string, env: NodeJS.ProcessEnv): { file: string; args: string[] } {
  if (platform === 'win32') {
    if (profile.shell === 'wsl') return { file: 'wsl.exe', args: ['--', 'bash', '-lc', command] };
    if (profile.shell === 'cmd') return { file: 'cmd.exe', args: ['/d', '/s', '/c', command] };
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', command] };
  }
  const file = profile.shell === 'bash' ? '/bin/bash' : profile.shell === 'zsh' ? '/bin/zsh' : env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  const args = ['-lc', command];
  if (env.FLATPAK_ID) return { file: 'flatpak-spawn', args: ['--host', file, ...args] };
  return { file, args };
}
