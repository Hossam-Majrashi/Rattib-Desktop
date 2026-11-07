import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import { actions, extractVersion, isPresent, type Action, type Platform, type Presence, type Profile, type Run, type TerminalEvent } from '../shared/model.ts';
import { commandDisplay, t, type MessageKey } from '../shared/i18n.ts';
import { shellCommand } from './shell';
import { LocalStore } from './store';
import { createLinuxShortcut } from './desktop';

let window: BrowserWindow;
let store: LocalStore;
let confirming = false;
let quitting = false;
let current: { run: Run; process: pty.IPty; exited: boolean; completion?: Promise<void> } | undefined;
const platform = process.platform as Platform;
const text = (key: MessageKey, values: Record<string, string | number> = {}) => t(store.settings().language, key, values);
const send = (event: TerminalEvent) => { if (window && !window.isDestroyed()) window.webContents.send('terminal:event', event); };
function trusted(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender.');
}
function getTool(id: unknown) {
  const tool = typeof id === 'string' ? store.tool(id) : undefined;
  const profile = tool?.profiles[platform];
  if (!tool || !profile) throw new Error(text('errorCommand'));
  return { tool, profile };
}
async function stateChange(id: string, profile: Profile, patch: Partial<Presence>) {
  const state = await store.updatePresence(id, profile, patch);
  send({ type: 'presence', toolId: id, state });
  return state;
}
function shortcutAvailable() { return platform === 'linux' && app.isPackaged && !process.env.FLATPAK_ID; }

function registerIPC() {
  ipcMain.handle('app:info', event => {
    trusted(event); return { platform, version: app.getVersion(), flatpak: Boolean(process.env.FLATPAK_ID), shortcutAvailable: shortcutAvailable() };
  });
  ipcMain.handle('tools:list', event => { trusted(event); return store.list(); });
  ipcMain.handle('tools:save', (event, value: unknown) => { trusted(event); return store.saveTools(value); });
  ipcMain.handle('settings:get', event => { trusted(event); return store.settings(); });
  ipcMain.handle('settings:save', (event, value: unknown) => { trusted(event); return store.saveSettings(value); });
  ipcMain.handle('presence:list', event => { trusted(event); return store.presence(); });
  ipcMain.handle('presence:link', async (event, id: unknown) => {
    trusted(event);
    if (confirming) throw new Error(text('errorBusy'));
    const { tool, profile } = getTool(id);
    confirming = true;
    try {
      const result = await dialog.showMessageBox(window, { type: 'question', message: text('linkQuestion'), detail: tool.name + '\n\n' + text('linkDetail'), buttons: [text('cancel'), text('confirm')], defaultId: 0, cancelId: 0 });
      return result.response === 1 ? await stateChange(tool.id, profile, { status: 'linked' }) : null;
    } finally { confirming = false; }
  });
  ipcMain.handle('presence:forget', async (event, id: unknown) => {
    trusted(event);
    if (confirming || current?.run.running) throw new Error(text('errorBusy'));
    const { tool, profile } = getTool(id);
    confirming = true;
    try {
      const result = await dialog.showMessageBox(window, { type: 'warning', message: text('forgetQuestion'), detail: text('forgetDetail'), buttons: [text('cancel'), text('confirm')], defaultId: 0, cancelId: 0 });
      return result.response === 1 ? await stateChange(tool.id, profile, { status: 'unknown', installedVersion: undefined, checkedAt: undefined }) : null;
    } finally { confirming = false; }
  });
  ipcMain.handle('app:shortcut', async event => {
    trusted(event);
    if (!shortcutAvailable()) throw new Error(text('shortcutUnavailable'));
    if (confirming) throw new Error(text('errorBusy'));
    confirming = true;
    try {
      const result = await dialog.showMessageBox(window, { type: 'question', message: text('shortcutQuestion'), detail: text('shortcutDetail'), buttons: [text('cancel'), text('confirm')], defaultId: 0, cancelId: 0 });
      if (result.response !== 1) return null;
      const directory = process.env.XDG_DATA_HOME && isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : join(homedir(), '.local', 'share');
      return await createLinuxShortcut(process.env.APPIMAGE || process.execPath, join(app.getAppPath(), 'assets', 'icons', '512x512.png'), directory);
    } finally { confirming = false; }
  });
  ipcMain.handle('terminal:run', async (event, id: unknown, action: unknown) => {
    trusted(event);
    if (confirming || current?.run.running) throw new Error(text('errorBusy'));
    if (!actions.includes(action as Action)) throw new Error('Invalid action.');
    const { tool, profile } = getTool(id);
    const requested = action as Action;
    const state = store.state(tool.id);
    if (requested === 'install' && isPresent(state)) return { skipped: true, toolId: tool.id, state };
    if (!profile.commands[requested].trim()) throw new Error(text('errorCommand'));
    let a = requested;
    let installProbe = false;
    confirming = true;
    try {
      if (requested === 'install' && profile.commands.version.trim()) {
        if (state.status === 'check-failed') {
          const choice = await dialog.showMessageBox(window, { type: 'warning', message: text('failedProbeQuestion'), detail: text('failedProbeDetail'), buttons: [text('cancel'), text('checkAgain'), text('installAnyway')], defaultId: 0, cancelId: 0 });
          if (choice.response === 0) return null;
          if (choice.response === 1) { a = 'version'; installProbe = true; }
        } else { a = 'version'; installProbe = true; }
      }
      const command = profile.commands[a];
      const answer = await dialog.showMessageBox(window, {
        type: a === 'uninstall' ? 'warning' : 'question',
        title: `${text('action.' + a as MessageKey)} — ${tool.name}`,
        message: text(installProbe ? 'probeQuestion' : 'runQuestion'),
        detail: (installProbe ? text('probeDetail') + '\n\n' : '') + commandDisplay(command) + '\n\n' + text('shellLabel') + ': ' + profile.shell + '\n' + text('commandRisk'),
        buttons: [text('cancel'), text(installProbe ? 'probeButton' : 'runButton')], defaultId: 0, cancelId: 0, noLink: true
      });
      if (answer.response !== 1) return null;
      // Recheck after asynchronous confirmation: saved state cannot be bypassed through IPC.
      if (a === 'install' && isPresent(store.state(tool.id))) return { skipped: true, toolId: tool.id, state: store.state(tool.id) };
      if (['install', 'update', 'uninstall', 'version'].includes(a)) await stateChange(tool.id, profile, { status: 'unknown', installedVersion: undefined, checkedAt: undefined });
      if (a === 'latest') await stateChange(tool.id, profile, { latestVersion: undefined });
      const spec = shellCommand(platform, profile, command, process.env);
      const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
      delete env.ELECTRON_RUN_AS_NODE;
      const terminal = pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols: 100, rows: 26, cwd: homedir(), env });
      const run: Run = { id: randomUUID(), toolId: tool.id, toolName: tool.name, action: a, running: true, installProbe };
      const active = { run, process: terminal, exited: false, completion: undefined as Promise<void> | undefined };
      current = active;
      let captured = '';
      let truncated = false;
      terminal.onData(data => {
        if (a === 'version' || a === 'latest') {
          if (captured.length + data.length <= 262144) captured += data;
          else truncated = true;
        }
        send({ type: 'data', id: run.id, data });
      });
      terminal.onExit(({ exitCode, signal }) => {
        active.exited = true;
        active.completion = (async () => {
          try {
            if (a === 'version' || a === 'latest') {
              const version = !truncated && exitCode === 0 ? extractVersion(captured) : null;
              if (a === 'version') await stateChange(tool.id, profile, { status: version ? 'verified' : 'check-failed', installedVersion: version ?? undefined, checkedAt: Date.now() });
              else if (version) await stateChange(tool.id, profile, { latestVersion: version });
              if (version) send({ type: 'version', toolId: tool.id, action: a, version });
            }
            if (a === 'launch' && exitCode === 0) await stateChange(tool.id, profile, { status: isPresent(store.state(tool.id)) ? store.state(tool.id).status : 'linked', launchedAt: Date.now() });
          } catch (error) { send({ type: 'error', message: String(error) }); }
          finally { run.running = false; send({ type: 'exit', id: run.id, exitCode, signal }); }
        })();
      });
      return { ...run };
    } finally { confirming = false; }
  });
  ipcMain.on('terminal:input', (event, id: unknown, data: unknown) => {
    trusted(event);
    if (current && id === current.run.id && current.run.running && !current.exited && typeof data === 'string' && data.length <= 65536) {
      try { current.process.write(data); } catch { /* Process may have just exited. */ }
    }
  });
  ipcMain.on('terminal:resize', (event, id: unknown, cols: unknown, rows: unknown) => {
    trusted(event);
    if (id !== current?.run.id || !current?.run.running || current.exited) return;
    if (typeof cols === 'number' && typeof rows === 'number' && Number.isInteger(cols) && Number.isInteger(rows) && cols >= 2 && cols <= 500 && rows >= 2 && rows <= 300) {
      try { current.process.resize(cols, rows); } catch { /* Process may have just exited. */ }
    }
  });
  ipcMain.handle('terminal:stop', async (event, id: unknown) => {
    trusted(event);
    if (id !== current?.run.id || !current?.run.running || current.exited) return false;
    const answer = await dialog.showMessageBox(window, { type: 'warning', message: text('stopQuestion'), detail: text('stopDetail'), buttons: [text('continueProcess'), text('stop')], defaultId: 0, cancelId: 0 });
    if (answer.response !== 1 || id !== current?.run.id || !current?.run.running || current.exited) return false;
    try { current.process.kill(); } catch { return false; }
    return true;
  });
}
function createWindow() {
  window = new BrowserWindow({
    width: 1240, height: 900, minWidth: 900, minHeight: 650,
    title: 'Rattib Desktop', backgroundColor: '#0c1019', icon: join(app.getAppPath(), 'assets', 'icon.png'),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false }
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (!quitting && current?.run.running) {
      if (current.exited && current.completion) {
        event.preventDefault(); void current.completion.then(() => { if (!window.isDestroyed()) window.close(); }); return;
      }
      const answer = dialog.showMessageBoxSync(window, { type: 'warning', message: text('closeQuestion'), detail: text('closeDetail'), buttons: [text('stay'), text('stopClose')], defaultId: 0, cancelId: 0 });
      if (answer !== 1) { event.preventDefault(); return; }
      quitting = true;
      try { current.process.kill(); } catch { /* Already stopped. */ }
    }
  });
  const devURL = process.env.RATTIB_DEV_URL;
  if (!app.isPackaged && devURL === 'http://127.0.0.1:5173') void window.loadURL(devURL);
  else void window.loadFile(join(__dirname, 'renderer', 'index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    try {
      store = new LocalStore(app.getPath('userData'), platform);
      await store.init();
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.defaultSession.setPermissionCheckHandler(() => false);
      registerIPC(); createWindow();
      app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    } catch (error) {
      dialog.showErrorBox('Rattib Desktop', `${t('en', 'startupError')}\n${String(error)}`);
      app.quit();
    }
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
