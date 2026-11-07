import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import { actions, extractVersion, validateTools, type Action, type Platform, type Run, type TerminalEvent, type Tool } from '../shared/model';
import { shellCommand } from './shell';

let window: BrowserWindow;
let tools: Tool[] = [];
let saving = Promise.resolve();
let confirming = false;
let quitting = false;
let current: { run: Run; process: pty.IPty } | undefined;
const platform = process.platform as Platform;
const labels: Record<Action, string> = { install: 'تثبيت', version: 'قراءة الإصدار', latest: 'التحقق من أحدث إصدار', update: 'تحديث', uninstall: 'إلغاء التثبيت' };
const send = (event: TerminalEvent) => { if (window && !window.isDestroyed()) window.webContents.send('terminal:event', event); };
function trusted(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender.');
}
function dataPath() { return join(app.getPath('userData'), 'tools.json'); }
async function loadTools() {
  try { tools = validateTools(JSON.parse(await readFile(dataPath(), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
function registerIPC() {
  ipcMain.handle('app:info', event => {
    trusted(event); return { platform, version: app.getVersion(), flatpak: Boolean(process.env.FLATPAK_ID) };
  });
  ipcMain.handle('tools:list', event => { trusted(event); return tools; });
  ipcMain.handle('tools:save', (event, value: unknown) => {
    trusted(event);
    const next = validateTools(value);
    const task = saving.then(async () => {
      await mkdir(app.getPath('userData'), { recursive: true });
      const temp = `${dataPath()}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(temp, dataPath());
      tools = next;
    });
    saving = task.catch(() => undefined);
    return task;
  });
  ipcMain.handle('terminal:run', async (event, id: unknown, action: unknown) => {
    trusted(event);
    if (confirming || current?.run.running) throw new Error('هناك عملية جارية؛ انتظر انتهاءها أو أوقفها أولًا.');
    if (typeof id !== 'string' || !actions.includes(action as Action)) throw new Error('Invalid action.');
    const tool = tools.find(t => t.id === id);
    const profile = tool?.profiles[platform];
    const a = action as Action;
    const command = profile?.commands[a];
    if (!tool || !profile || !command?.trim()) throw new Error('لا يوجد أمر مُعدّ لهذا النظام.');
    confirming = true;
    try {
      const answer = await dialog.showMessageBox(window, {
        type: a === 'uninstall' ? 'warning' : 'question',
        title: `${labels[a]} — ${tool.name}`,
        message: 'هل تريد تشغيل هذا الأمر؟',
        detail: `${command}\n\nالبيئة: ${profile.shell}\nالأوامر تعمل بصلاحيات حسابك، وقد تقرأ ملفاتك أو تغيّرها. تنزيل سكربت وتشغيله لا يضمن أمانه. لن يختار Rattib إجابات نيابةً عنك.`,
        buttons: ['إلغاء', 'تشغيل'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (answer.response !== 1) return null;
      const spec = shellCommand(platform, profile, command, process.env);
      const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
      delete env.ELECTRON_RUN_AS_NODE;
      const terminal = pty.spawn(spec.file, spec.args, {
        name: 'xterm-256color', cols: 100, rows: 26, cwd: homedir(), env
      });
      const run: Run = { id: randomUUID(), toolId: tool.id, toolName: tool.name, action: a, running: true };
      current = { run, process: terminal };
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
        run.running = false;
        send({ type: 'exit', id: run.id, exitCode, signal });
        if (!truncated && exitCode === 0 && (a === 'version' || a === 'latest')) {
          const version = extractVersion(captured);
          if (version) send({ type: 'version', toolId: tool.id, action: a, version });
        }
      });
      return { ...run };
    } finally { confirming = false; }
  });
  ipcMain.on('terminal:input', (event, id: unknown, data: unknown) => {
    trusted(event);
    if (id === current?.run.id && current?.run.running && typeof data === 'string' && data.length <= 65536) current.process.write(data);
  });
  ipcMain.on('terminal:resize', (event, id: unknown, cols: unknown, rows: unknown) => {
    trusted(event);
    if (id !== current?.run.id || !current?.run.running) return;
    if (typeof cols === 'number' && typeof rows === 'number' && Number.isInteger(cols) && Number.isInteger(rows) && cols >= 2 && cols <= 500 && rows >= 2 && rows <= 300) {
      try { current.process.resize(cols, rows); } catch { /* The process may have exited. */ }
    }
  });
  ipcMain.handle('terminal:stop', async (event, id: unknown) => {
    trusted(event);
    if (id !== current?.run.id || !current?.run.running) return false;
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', message: 'إيقاف العملية؟', detail: 'الإيقاف لا يتراجع عن التغييرات التي حدثت. قد تستمر عمليات منفصلة أطلقتها الأداة.',
      buttons: ['متابعة العملية', 'إيقاف'], defaultId: 0, cancelId: 0
    });
    if (answer.response !== 1 || id !== current?.run.id || !current?.run.running) return false;
    current.process.kill();
    return true;
  });
}
function createWindow() {
  window = new BrowserWindow({
    width: 1240, height: 880, minWidth: 900, minHeight: 650,
    title: 'Rattib Desktop', backgroundColor: '#0c1019',
    icon: join(app.getAppPath(), 'assets', 'icon.png'),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false }
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (!quitting && current?.run.running) {
      const answer = dialog.showMessageBoxSync(window, {
        type: 'warning', message: 'هناك عملية جارية. هل تريد إيقافها وإغلاق التطبيق؟',
        detail: 'قد يكون التثبيت أو الحذف غير مكتمل. العمليات المنفصلة قد تستمر.',
        buttons: ['البقاء', 'إيقاف وإغلاق'], defaultId: 0, cancelId: 0
      });
      if (answer !== 1) { event.preventDefault(); return; }
      quitting = true;
      current.process.kill();
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
      await loadTools();
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.defaultSession.setPermissionCheckHandler(() => false);
      registerIPC();
      createWindow();
      app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    } catch (error) {
      dialog.showErrorBox('Rattib Desktop', `تعذر بدء التطبيق؛ لم تتم الكتابة فوق إعداداتك.\n${String(error)}`);
      app.quit();
    }
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
