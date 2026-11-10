import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import * as pty from 'node-pty';
import { actions, commandIssue, type Action, type Platform, type TerminalEvent } from '../shared/model.ts';
import { commandDisplay, t, type MessageKey } from '../shared/i18n.ts';
import { shellCommand } from './shell';
import { LocalStore } from './store';
import { createLinuxShortcut } from './desktop';
import { ToolOperation, type Confirmation } from './operation';

let window: BrowserWindow;
let store: LocalStore;
let confirming = false;
let quitting = false;
let current: ToolOperation | undefined;
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
function shortcutAvailable() { return platform === 'linux' && app.isPackaged && !process.env.FLATPAK_ID; }

function registerIPC() {
  ipcMain.handle('app:info', event => {
    trusted(event); return { platform, version: app.getVersion(), flatpak: Boolean(process.env.FLATPAK_ID), shortcutAvailable: shortcutAvailable() };
  });
  ipcMain.handle('tools:list', event => { trusted(event); return store.list(); });
  ipcMain.handle('tools:save', (event, value: unknown) => {
    trusted(event);
    if (confirming || current?.run.running) throw new Error(text('errorBusy'));
    return store.saveTools(value);
  });
  ipcMain.handle('settings:get', event => { trusted(event); return store.settings(); });
  ipcMain.handle('settings:save', (event, value: unknown) => { trusted(event); return store.saveSettings(value); });
  ipcMain.handle('presence:list', event => { trusted(event); return store.presence(); });
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
    const issue = commandIssue(profile, requested);
    if (issue) throw new Error(text(issue));
    const preflight = requested === 'install' || requested === 'update';
    const confirm = async (a: Action, kind: Confirmation): Promise<boolean> => {
      if (confirming) throw new Error(text('errorBusy'));
      confirming = true;
      try {
        const prefix = kind === 'preflight' ? text('probeDetail') : kind === 'unverified-install' ? text('failedProbeDetail') : '';
        const planned = kind === 'preflight' ? '\n\n' + text('plannedCommand') + '\n' + text(`action.${requested}`) + ':\n' + commandDisplay(profile.commands[requested]) : '';
        const postcheck = kind === 'preflight' || a === 'install' || a === 'update' ? '\n\n' + text('mutationCheckHint') + '\n' + commandDisplay(profile.commands.version) : '';
        const answer = await dialog.showMessageBox(window, {
          type: a === 'uninstall' || kind === 'unverified-install' ? 'warning' : 'question',
          title: `${text('action.' + (kind === 'preflight' ? requested : a) as MessageKey)} — ${tool.name}`,
          message: text(kind === 'preflight' ? 'probeQuestion' : kind === 'unverified-install' ? 'failedProbeQuestion' : 'runQuestion'),
          detail: (prefix ? prefix + '\n\n' : '') + commandDisplay(profile.commands[a]) + planned + postcheck + '\n\n' + text('shellLabel') + ': ' + profile.shell + '\n' + text('commandRisk'),
          buttons: [text('cancel'), text(kind === 'preflight' ? 'probeButton' : kind === 'unverified-install' ? 'installAnyway' : 'runButton')],
          defaultId: 0, cancelId: 0, noLink: true
        });
        return answer.response === 1;
      } finally { confirming = false; }
    };
    if (!await confirm(preflight ? 'version' : requested, preflight ? 'preflight' : 'command')) return null;
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete env.ELECTRON_RUN_AS_NODE;
    const operation = new ToolOperation({
      tool, profile, platform, requested, store, send, text, confirm,
      spawn: (command, cols, rows) => {
        const spec = shellCommand(platform, profile, command, process.env);
        return pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols, rows, cwd: homedir(), env });
      }
    });
    current = operation;
    return operation.start();
  });
  ipcMain.on('terminal:input', (event, id: unknown, data: unknown) => {
    trusted(event);
    if (current && id === current.run.id && current.run.running && !current.exited && typeof data === 'string' && data.length <= 65536) {
      try { current.process?.write(data); } catch { /* Process may have just exited. */ }
    }
  });
  ipcMain.on('terminal:resize', (event, id: unknown, cols: unknown, rows: unknown) => {
    trusted(event);
    if (id !== current?.run.id || !current?.run.running) return;
    if (typeof cols === 'number' && typeof rows === 'number' && Number.isInteger(cols) && Number.isInteger(rows) && cols >= 2 && cols <= 500 && rows >= 2 && rows <= 300) {
      try { current.resize(cols, rows); } catch { /* Process may have just exited. */ }
    }
  });
  ipcMain.handle('terminal:stop', async (event, id: unknown) => {
    trusted(event);
    if (id !== current?.run.id || !current?.run.running || confirming) return false;
    const answer = await dialog.showMessageBox(window, { type: 'warning', message: text('stopQuestion'), detail: text('stopDetail'), buttons: [text('continueProcess'), text('stop')], defaultId: 0, cancelId: 0 });
    if (answer.response !== 1 || id !== current?.run.id || !current?.run.running) return false;
    try { current.cancel(); } catch { return false; }
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
        event.preventDefault(); current.cancel(); void current.completion.then(() => { if (!window.isDestroyed()) window.close(); }); return;
      }
      const answer = dialog.showMessageBoxSync(window, { type: 'warning', message: text('closeQuestion'), detail: text('closeDetail'), buttons: [text('stay'), text('stopClose')], defaultId: 0, cancelId: 0 });
      if (answer !== 1) { event.preventDefault(); return; }
      quitting = true;
      try { current.cancel(); } catch { /* Already stopped. */ }
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
