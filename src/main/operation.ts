import { randomUUID } from 'node:crypto';
import type { IPty } from 'node-pty';
import { extractVersion, type Action, type Platform, type Presence, type Profile, type Run, type TerminalEvent, type Tool } from '../shared/model.ts';
import type { MessageKey } from '../shared/i18n.ts';
import type { LocalStore } from './store.ts';

export type Confirmation = 'preflight' | 'command' | 'unverified-install';
type Stage = 'preflight' | 'command' | 'postflight';
interface Host {
  tool: Tool; profile: Profile; platform: Platform; requested: Action; store: LocalStore;
  send(event: TerminalEvent): void;
  text(key: MessageKey, values?: Record<string, string | number>): string;
  confirm(action: Action, kind: Confirmation): Promise<boolean>;
  spawn(command: string, cols: number, rows: number): IPty;
}
// One user operation / terminal session, even when checking before and after a mutation.
// Cached presence never substitutes for a fresh user-triggered check.
export class ToolOperation {
  readonly run: Run;
  process?: IPty;
  exited = true;
  completion: Promise<void> = Promise.resolve();
  private host: Host;
  private cancelled = false;
  private cols = 100;
  private rows = 26;
  constructor(host: Host) {
    this.host = host;
    const phase = ['install', 'update'].includes(host.requested) ? 'version' : host.requested;
    this.run = { id: randomUUID(), toolId: host.tool.id, toolName: host.tool.name, action: host.requested, phase, running: true };
  }
  async start(): Promise<Run> {
    try {
      if (['install', 'update'].includes(this.run.action) && !this.host.profile.commands.version.trim()) throw new Error(this.host.text('versionRequired'));
      const starting = this.startPhase(this.run.phase, ['install', 'update'].includes(this.run.action) ? 'preflight' : 'command');
      this.completion = starting.catch(() => undefined);
      await starting;
      return { ...this.run };
    } catch (error) { this.finish(1); throw error; }
  }
  resize(cols: number, rows: number): void {
    this.cols = cols; this.rows = rows;
    if (!this.exited) this.process?.resize(cols, rows);
  }
  cancel(): void {
    this.cancelled = true;
    if (!this.exited) this.process?.kill();
  }
  private assertCurrentProfile() {
    const profile = this.host.store.tool(this.run.toolId)?.profiles[this.host.platform];
    if (JSON.stringify(profile) !== JSON.stringify(this.host.profile)) throw new Error(this.host.text('changedProfile'));
  }
  private async state(patch: Partial<Presence>) {
    const state = await this.host.store.updatePresence(this.run.toolId, this.host.profile, patch);
    this.host.send({ type: 'presence', toolId: this.run.toolId, state });
  }
  private finish(exitCode: number, signal?: number) {
    if (!this.run.running) return;
    this.run.running = false;
    this.host.send({ type: 'exit', id: this.run.id, exitCode, signal });
  }
  private async startPhase(action: Action, stage: Stage): Promise<void> {
    if (this.cancelled) { this.finish(130); return; }
    this.assertCurrentProfile();
    if (['install', 'update', 'uninstall', 'version'].includes(action)) await this.state({ status: 'unknown', installedVersion: undefined, checkedAt: undefined });
    if (action === 'latest') await this.state({ latestVersion: undefined });
    if (this.cancelled) { this.finish(130); return; }
    this.assertCurrentProfile();
    const terminal = this.host.spawn(this.host.profile.commands[action], this.cols, this.rows);
    this.process = terminal; this.exited = false; this.run.phase = action;
    this.host.send({ type: 'phase', id: this.run.id, action });
    let captured = '', truncated = false;
    terminal.onData(data => {
      if (action === 'version' || action === 'latest') {
        if (captured.length + data.length <= 262144) captured += data;
        else truncated = true;
      }
      this.host.send({ type: 'data', id: this.run.id, data });
    });
    terminal.onExit(({ exitCode, signal }) => {
      if (this.process !== terminal || this.exited) return;
      this.exited = true;
      this.completion = this.afterExit(action, stage, captured, truncated, exitCode, signal).catch(error => {
        this.host.send({ type: 'error', message: String(error) }); this.finish(1);
      });
    });
  }
  private async afterExit(action: Action, stage: Stage, captured: string, truncated: boolean, exitCode: number, signal?: number): Promise<void> {
    const version = !this.cancelled && !truncated && exitCode === 0 ? extractVersion(captured) : null;
    if (action === 'version') await this.state({ status: version ? 'verified' : 'check-failed', installedVersion: version ?? undefined, checkedAt: Date.now() });
    if (action === 'latest' && version) await this.state({ latestVersion: version });
    if ((action === 'version' || action === 'latest') && version) this.host.send({ type: 'version', toolId: this.run.toolId, action, version });
    if (this.cancelled) { this.finish(130, signal); return; }
    if (stage === 'preflight') {
      if (version && this.run.action === 'install') {
        this.host.send({ type: 'notice', message: this.host.text('alreadyPresent', { name: this.run.toolName, version }) });
        this.finish(0); return;
      }
      if (!version && this.run.action === 'update') {
        this.host.send({ type: 'notice', message: this.host.text('cannotUpdate') });
        this.finish(exitCode || 1, signal); return;
      }
      // Never infer absence from a failed check or silently run a modifying command.
      this.assertCurrentProfile();
      const approved = await this.host.confirm(this.run.action, version ? 'command' : 'unverified-install');
      if (!approved || this.cancelled) { this.finish(this.cancelled ? 130 : exitCode, signal); return; }
      await this.startPhase(this.run.action, 'command'); return;
    }
    if (stage === 'command' && (action === 'install' || action === 'update') && exitCode === 0) {
      await this.startPhase('version', 'postflight'); return;
    }
    if (stage === 'postflight' && !version) this.host.send({ type: 'notice', message: this.host.text('postcheckFailed') });
    if (action === 'launch' && exitCode === 0) await this.state({ launchedAt: Date.now() });
    this.finish(exitCode, signal);
  }
}
