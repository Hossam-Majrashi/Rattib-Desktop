export const platforms = ['linux', 'darwin', 'win32'] as const;
export type Platform = typeof platforms[number];
export const actions = ['install', 'version', 'latest', 'update', 'uninstall'] as const;
export type Action = typeof actions[number];
export const shells = ['auto', 'bash', 'zsh', 'powershell', 'cmd', 'wsl'] as const;
export type Shell = typeof shells[number];
export interface Profile { shell: Shell; commands: Record<Action, string> }
export interface Tool { id: string; name: string; profiles: Partial<Record<Platform, Profile>> }
export interface AppInfo { platform: Platform; version: string; flatpak: boolean }
export interface Run { id: string; toolId: string; toolName: string; action: Action; running: boolean }
export type TerminalEvent =
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; exitCode: number; signal?: number }
  | { type: 'version'; toolId: string; action: 'version' | 'latest'; version: string };
export interface API {
  info(): Promise<AppInfo>;
  list(): Promise<Tool[]>;
  save(tools: Tool[]): Promise<void>;
  run(toolId: string, action: Action): Promise<Run | null>;
  input(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  stop(id: string): Promise<boolean>;
  onTerminal(callback: (event: TerminalEvent) => void): () => void;
}
export function blankProfile(): Profile {
  return { shell: 'auto', commands: { install: '', version: '', latest: '', update: '', uninstall: '' } };
}
export function validateTools(value: unknown): Tool[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid tool list (maximum 500).');
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid tool.');
    const t = item as Record<string, unknown>;
    if (typeof t.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(t.id) || ids.has(t.id)) throw new Error('Invalid or duplicate ID.');
    ids.add(t.id);
    if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > 120) throw new Error('Invalid tool name.');
    if (!t.profiles || typeof t.profiles !== 'object' || Array.isArray(t.profiles)) throw new Error('Invalid profiles.');
    const profiles: Tool['profiles'] = {};
    for (const [key, value] of Object.entries(t.profiles)) {
      if (!platforms.includes(key as Platform)) throw new Error('Unsupported platform.');
      if (!value || typeof value !== 'object') throw new Error('Invalid profile.');
      const p = value as Record<string, unknown>;
      if (!shells.includes(p.shell as Shell)) throw new Error('Unsupported shell.');
      if (key !== 'win32' && ['powershell', 'cmd', 'wsl'].includes(p.shell as string)) throw new Error('Windows shell on non-Windows platform.');
      if (key === 'win32' && ['bash', 'zsh'].includes(p.shell as string)) throw new Error('Use WSL for a Linux shell on Windows.');
      if (!p.commands || typeof p.commands !== 'object') throw new Error('Invalid commands.');
      const commands = {} as Profile['commands'];
      for (const a of actions) {
        const c = (p.commands as Record<string, unknown>)[a];
        if (typeof c !== 'string' || c.length > 16384 || c.includes('\0')) throw new Error('Invalid command.');
        commands[a] = c;
      }
      profiles[key as Platform] = { shell: p.shell as Shell, commands };
    }
    return { id: t.id, name: t.name.trim(), profiles };
  });
}
export function extractVersion(text: string): string | null {
  // Only accept an unambiguous three-part version; never guess from arbitrary logs.
  const plain = text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const matches = [...plain.matchAll(/\bv?(\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?![\w.])/g)].map(m => m[1]);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}
export type UpdateState = 'unknown' | 'equal' | 'available' | 'installed-newer' | 'manual';
export function compareVersions(installed?: string, latest?: string): UpdateState {
  if (!installed || !latest) return 'unknown';
  if (installed === latest) return 'equal';
  if (!/^\d+\.\d+\.\d+$/.test(installed) || !/^\d+\.\d+\.\d+$/.test(latest)) return 'manual';
  const a = installed.split('.').map(Number), b = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? 'available' : 'installed-newer';
  return 'equal';
}
