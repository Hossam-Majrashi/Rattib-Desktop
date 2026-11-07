import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { defaultSettings, validateSettings, validateTools, type Platform, type Presence, type Profile, type Settings, type Tool } from '../shared/model.ts';

interface SavedPresence extends Presence { fingerprint: string }
type Records = Record<string, Partial<Record<Platform, SavedPresence>>>;
export function presenceFingerprint(profile: Profile): string {
  // Updating an install/update/uninstall command must not forget a known installation.
  const identity = profile.commands.version.trim() || profile.commands.launch.trim();
  return createHash('sha256').update(JSON.stringify([profile.shell, identity])).digest('hex');
}
export class LocalStore {
  private directory: string;
  private platform: Platform;
  private tools: Tool[] = [];
  private preferences: Settings = { ...defaultSettings };
  private records: Records = {};
  private queue: Promise<void> = Promise.resolve();
  constructor(directory: string, platform: Platform) { this.directory = directory; this.platform = platform; }
  private async load(name: string, fallback: unknown): Promise<unknown> {
    try { return JSON.parse(await readFile(join(this.directory, name), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
  }
  async init(): Promise<void> {
    this.tools = validateTools(await this.load('tools.json', []));
    this.preferences = validateSettings(await this.load('settings.json', defaultSettings));
    const raw = await this.load('presence.json', {});
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid saved installation state.');
    const records: Records = {};
    for (const tool of this.tools) {
      const platforms = (raw as Record<string, unknown>)[tool.id];
      if (!platforms || typeof platforms !== 'object') continue;
      for (const platform of ['linux', 'darwin', 'win32'] as const) {
        const state = (platforms as Record<string, unknown>)[platform] as SavedPresence | undefined;
        const profile = tool.profiles[platform];
        if (!profile || !state || state.fingerprint !== presenceFingerprint(profile)) continue;
        if (!['unknown', 'verified', 'linked', 'check-failed'].includes(state.status)) throw new Error('Invalid presence status.');
        for (const field of ['installedVersion', 'latestVersion'] as const) if (state[field] !== undefined && (typeof state[field] !== 'string' || state[field].length > 100)) throw new Error('Invalid saved version.');
        for (const field of ['checkedAt', 'launchedAt'] as const) if (state[field] !== undefined && (typeof state[field] !== 'number' || !Number.isFinite(state[field]) || state[field] < 0)) throw new Error('Invalid saved timestamp.');
        records[tool.id] ??= {};
        records[tool.id][platform] = { ...state };
      }
    }
    this.records = records;
  }
  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async write(name: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, name);
    const temporary = target + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temporary, target);
  }
  list(): Tool[] { return structuredClone(this.tools); }
  tool(id: string): Tool | undefined { return this.list().find(tool => tool.id === id); }
  settings(): Settings { return { ...this.preferences }; }
  state(id: string): Presence {
    const profile = this.tools.find(tool => tool.id === id)?.profiles[this.platform];
    const saved = this.records[id]?.[this.platform];
    if (!profile || saved?.fingerprint !== presenceFingerprint(profile)) return { status: 'unknown' };
    const { fingerprint: _fingerprint, ...state } = saved;
    return { ...state };
  }
  presence(): Record<string, Presence> { return Object.fromEntries(this.tools.map(tool => [tool.id, this.state(tool.id)])); }
  async saveTools(value: unknown): Promise<void> {
    const next = validateTools(value);
    await this.enqueue(async () => {
      const records = structuredClone(this.records);
      for (const id of Object.keys(records)) {
        const nextTool = next.find(tool => tool.id === id);
        if (!nextTool) { delete records[id]; continue; }
        for (const platform of ['linux', 'darwin', 'win32'] as const) {
          const profile = nextTool.profiles[platform];
          const state = records[id][platform];
          if (!profile || !state || state.fingerprint !== presenceFingerprint(profile)) delete records[id][platform];
          else if (this.tools.find(tool => tool.id === id)?.profiles[platform]?.commands.latest !== profile.commands.latest) delete state.latestVersion;
        }
      }
      await this.write('tools.json', next);
      this.tools = next;
      await this.write('presence.json', records);
      this.records = records;
    });
  }
  async saveSettings(value: unknown): Promise<Settings> {
    const next = validateSettings(value);
    await this.enqueue(async () => { await this.write('settings.json', next); this.preferences = next; });
    return this.settings();
  }
  async updatePresence(id: string, expected: Profile, change: Partial<Presence>): Promise<Presence> {
    await this.enqueue(async () => {
      const profile = this.tools.find(tool => tool.id === id)?.profiles[this.platform];
      if (!profile || presenceFingerprint(profile) !== presenceFingerprint(expected)) return;
      const patch = { ...change };
      if (profile.commands.latest !== expected.commands.latest) delete patch.latestVersion;
      const records = structuredClone(this.records);
      records[id] ??= {};
      records[id][this.platform] = { ...this.state(id), ...patch, fingerprint: presenceFingerprint(profile) };
      await this.write('presence.json', records);
      this.records = records;
    });
    return this.state(id);
  }
}
