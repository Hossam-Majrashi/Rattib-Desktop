// Isolated integration tests. All commands use our safe local fixture, never user tools.
const { app, dialog, BrowserWindow } = require('electron');
const { resolve, join } = require('node:path');
const { writeFileSync, mkdirSync } = require('node:fs');
// CI desktop sessions can leave the test window occluded, especially on Windows ARM.
// Disable background scheduling only in this isolated test, never in the shipped app.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const profile = process.env.RATTIB_SMOKE_PROFILE;
if (!profile) throw new Error('Use npm run test:smoke for an isolated test profile.');
app.setPath('userData', profile);
const confirmations = [];
dialog.showMessageBox = async (...args) => {
  const options = args[args.length - 1];
  confirmations.push(options);
  const uncertain = ['The last version check did not verify this tool.', 'لم يتمكن آخر فحص من التحقق من هذه الأداة.'].includes(options.message);
  return { response: uncertain ? 0 : 1, checkboxChecked: false };
};
let finished = false;
let stage = 'boot';
function progress(value) { stage = value; console.log('SMOKE_STAGE ' + value); }
const timeout = setTimeout(() => finish(1, 'SMOKE_TIMEOUT at ' + stage), 75000);
function finish(code, message) {
  if (finished) return;
  finished = true; clearTimeout(timeout);
  if (code !== 0) {
    const report = { stage, platform: process.platform, arch: process.arch, message };
    if (process.env.RATTIB_SMOKE_REPORT_DIR) {
      try {
        mkdirSync(process.env.RATTIB_SMOKE_REPORT_DIR, { recursive: true });
        writeFileSync(join(process.env.RATTIB_SMOKE_REPORT_DIR, 'failure.json'), JSON.stringify(report, null, 2));
      } catch (error) { console.error('Could not write smoke report:', String(error)); }
    }
    if (process.env.GITHUB_ACTIONS === 'true') {
      const escaped = ('[' + stage + '] ' + message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
      console.error('::error title=Electron smoke test failed::' + escaped);
    }
  }
  console.log(message); app.exit(code);
}
// Do not let Electron's default modal error dialog hide a CI exception forever.
process.on('uncaughtException', error => finish(1, error.stack ?? String(error)));
process.on('unhandledRejection', error => finish(1, error?.stack ?? String(error)));
app.on('web-contents-created', (_event, contents) => {
  contents.setBackgroundThrottling(false);
  const focusWindow = () => {
    const window = BrowserWindow.fromWebContents(contents);
    if (window?.isMinimized()) window.restore();
    window?.show(); window?.focus(); contents.focus();
  };
  contents.once('did-finish-load', async () => {
    try {
      focusWindow();
      progress('backend');
      const fixture = resolve('tests/interactive-fixture.mjs');
      const backend = await contents.executeJavaScript(`(async () => {
        const wait = async predicate => {
          for (let i = 0; i < 300; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
          throw new Error('Timed out waiting for fixture state');
        };
        await wait(() => document.querySelector('h1')?.textContent.includes('Rattib Desktop'));
        if (typeof window.require !== 'undefined' || typeof window.process !== 'undefined') throw new Error('Renderer Node isolation failed');
        if ((await window.rattib.list()).length) throw new Error('Inventory was not empty');
        const info = await window.rattib.info();
        const base = 'node ' + JSON.stringify(${JSON.stringify(fixture)});
        const commands = { install: base + ' --install-marker', version: base + ' --version', latest: base + ' --version', update: base + ' --update-marker', uninstall: '' };
        const legacy = { id: 'safe-fixture', name: 'Safe fixture', profiles: { [info.platform]: { shell: 'auto', commands } } };
        await window.rattib.save([legacy]);
        if ((await window.rattib.list())[0].profiles[info.platform].commands.launch !== '') throw new Error('Legacy migration failed');
        const tools = [
          { ...legacy, profiles: { [info.platform]: { shell: 'auto', commands: { ...commands, launch: base } } } },
          { id: 'existing-launch', name: 'Existing launch tool', profiles: { [info.platform]: { shell: 'auto', commands: { ...commands, version: '', launch: base + ' --launch' } } } },
          { id: 'missing-fixture', name: 'Failed check fixture', profiles: { [info.platform]: { shell: 'auto', commands: { ...commands, launch: '', version: base + ' --missing' } } } }
        ];
        const invalid = structuredClone(tools);
        invalid[0].profiles[info.platform].commands.update = commands.version;
        invalid[0].profiles[info.platform].commands.latest = commands.version;
        await window.rattib.save(invalid);
        for (const action of ['update', 'latest']) {
          let rejected = false;
          try { await window.rattib.run('safe-fixture', action); } catch { rejected = true; }
          if (!rejected) throw new Error('IPC accepted local-version command as ' + action);
        }
        await window.rattib.save(tools);
        const seen = [];
        const off = window.rattib.onTerminal(event => seen.push(event));
        const exited = run => seen.some(event => event.type === 'exit' && event.id === run.id);
        const output = run => seen.filter(event => event.type === 'data' && event.id === run.id).map(event => event.data).join('');
        const probe = await window.rattib.run('safe-fixture', 'install');
        if (probe?.action !== 'install' || probe.phase !== 'version') throw new Error('Install did not check existing version first');
        await wait(() => exited(probe));
        if ((await window.rattib.presence())['safe-fixture'].status !== 'verified') throw new Error('Verified presence not saved');
        const duplicate = await window.rattib.run('safe-fixture', 'install');
        if (duplicate?.phase !== 'version') throw new Error('A cached result bypassed fresh detection');
        await wait(() => exited(duplicate));
        const update = await window.rattib.run('safe-fixture', 'update');
        await wait(() => exited(update));
        if (!output(update).includes('UPDATE_EXECUTED')) throw new Error('Verified updater did not run');
        const phases = seen.filter(event => event.type === 'phase' && event.id === update.id).map(event => event.action);
        if (JSON.stringify(phases) !== JSON.stringify(['version', 'update', 'version'])) throw new Error('Update did not verify before and after execution');
        const interactive = await window.rattib.run('safe-fixture', 'launch');
        await wait(() => output(interactive).includes('ARROW_MENU'));
        window.rattib.resize(interactive.id, 92, 30);
        window.rattib.input(interactive.id, '\\x1b[B\\r');
        await wait(() => output(interactive).includes('NUMERIC_MENU'));
        window.rattib.input(interactive.id, '2\\r');
        await wait(() => exited(interactive));
        if (!output(interactive).includes('INTERACTIVE_OK')) throw new Error('Interactive fixture failed');
        const failed = await window.rattib.run('missing-fixture', 'install');
        await wait(() => exited(failed));
        if ((await window.rattib.presence())['missing-fixture'].status !== 'check-failed') throw new Error('Failed detection state not saved');
        const failedUpdate = await window.rattib.run('missing-fixture', 'update');
        await wait(() => exited(failedUpdate));
        if (output(failedUpdate).includes('UPDATE_EXECUTED')) throw new Error('Updater ran without verified presence');
        if ('link' in window.rattib || 'forget' in window.rattib) throw new Error('Manual association API still exposed');
        if (seen.some(event => event.type === 'data' && event.data.includes('INSTALL_EXECUTED'))) throw new Error('An existing-tool installer was executed');
        await window.rattib.saveSettings({ language: 'en', arabicPreview: true });
        off();
        return { tty: true, arrows: true, numericInput: true, legacyMigration: true, duplicateInstallBlocked: true, detectionFailureSafe: true, freshChecks: true, updatePreAndPostChecks: true, noManualAssociation: true, rendererIsolated: true };
      })()`);
      const updateProbe = confirmations.find(options => options.title?.startsWith('تحديث —') && options.message === 'التحقق من وجود الأداة؟');
      if (!updateProbe?.detail.includes('--update-marker') || !updateProbe.detail.includes('--version')) throw new Error('Initial update confirmation does not show the updater and verification plan');
      progress('reload');
      const loaded = new Promise(resolveLoaded => contents.once('did-finish-load', resolveLoaded));
      contents.reload(); await loaded;
      progress('ui');
      const ui = await contents.executeJavaScript(`(async () => {
        const wait = async predicate => {
          for (let i = 0; i < 300; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
          throw new Error('Timed out waiting for UI update');
        };
        await wait(() => document.documentElement.lang === 'en' && document.querySelectorAll('[data-tool-id]').length === 3);
        if (document.documentElement.dir !== 'ltr') throw new Error('English direction not applied');
        const card = id => document.querySelector('[data-tool-id="' + id + '"]');
        if (card('safe-fixture').querySelector('[data-action="install"]').disabled) throw new Error('Fresh detection button was disabled for a cached installation');
        if (document.body.textContent.includes('Link as existing')) throw new Error('Manual association button still visible');
        if (document.querySelector('[data-action="latest"]') || document.body.textContent.includes('Latest from source')) throw new Error('Removed update-check UI is still visible');
        // Exercise the actual Update button with multi-version CLI output over a real PTY.
        const tools = await window.rattib.list();
        const platform = (await window.rattib.info()).platform;
        const profile = tools.find(tool => tool.id === 'safe-fixture').profiles[platform];
        const originalVersion = profile.commands.version;
        const base = 'node ' + JSON.stringify(${JSON.stringify(fixture)});
        for (const [mode, version] of [['strata', '0.2.12'], ['strata-updated', '0.2.13.1'], ['hermes', '0.23.1']]) {
          profile.commands.version = base + ' --' + mode + '-version';
          await window.rattib.save(tools);
          const seen = [];
          const off = window.rattib.onTerminal(event => seen.push(event));
          try {
            await wait(() => !card('safe-fixture').querySelector('[data-action="update"]').disabled);
            card('safe-fixture').querySelector('[data-action="update"]').click();
            await wait(() => seen.some(event => event.type === 'exit'));
            const phases = seen.filter(event => event.type === 'phase').map(event => event.action);
            if (JSON.stringify(phases) !== JSON.stringify(['version', 'update', 'version'])) throw new Error(mode + ' version output blocked the Update button');
            if (!seen.some(event => event.type === 'data' && event.data.includes('UPDATE_EXECUTED'))) throw new Error(mode + ' updater did not execute');
            const state = (await window.rattib.presence())['safe-fixture'];
            if (state.status !== 'verified' || state.installedVersion !== version) throw new Error(mode + ' product version not saved after update');
          } finally { off(); }
        }
        profile.commands.version = originalVersion;
        await window.rattib.save(tools);
        const restored = [];
        const offRestore = window.rattib.onTerminal(event => restored.push(event));
        try {
          const run = await window.rattib.run('safe-fixture', 'version');
          await wait(() => restored.some(event => event.type === 'exit' && event.id === run.id));
        } finally { offRestore(); }
        card('safe-fixture').querySelector('[data-ui="edit"]').click();
        await wait(() => document.querySelector('dialog[open] textarea[data-command="update"]'));
        if (document.querySelector('dialog[open] input[type="checkbox"]')) throw new Error('Manual association option still in tool editor');
        if (document.querySelector('textarea[data-command="latest"]')) throw new Error('Release-source editor still visible');
        const examples = { install: 'npm install -g <package-name>', launch: 'strata', version: 'strata --version', update: 'strata update', uninstall: 'strata uninstall' };
        for (const [action, example] of Object.entries(examples)) {
          const field = document.querySelector('textarea[data-command="' + action + '"]');
          if (field?.placeholder !== example || !document.getElementById(field.getAttribute('aria-describedby'))?.textContent.trim()) throw new Error('Missing example or explanation for ' + action);
        }
        const input = document.querySelector('textarea[data-command="update"]');
        const themedScrollbar = 'rgb(61, 80, 104) rgb(17, 25, 37)';
        if (getComputedStyle(input).scrollbarColor !== themedScrollbar || getComputedStyle(document.documentElement).scrollbarColor !== themedScrollbar) throw new Error('Native text/page scrollbars do not match the application palette');
        const setCommand = (element, value) => {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const versionCommand = document.querySelector('textarea[data-command="version"]').value;
        setCommand(input, versionCommand);
        await wait(() => document.querySelector('dialog[open] [role="alert"]')?.textContent.includes('actual updater'));
        setCommand(input, 'tool update --changed-flag');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 60));
        document.querySelector('dialog[open] button[value="save"]').click();
        await wait(async () => (await window.rattib.list()).find(tool => tool.id === 'safe-fixture').profiles[(await window.rattib.info()).platform].commands.update === 'tool update --changed-flag');
        await wait(() => !document.querySelector('dialog[open]'));
        if ((await window.rattib.presence())['safe-fixture'].installedVersion !== '1.5.0') throw new Error('Editing update command forgot installed version');
        const savedTool = (await window.rattib.list()).find(tool => tool.id === 'safe-fixture');
        if (savedTool.profiles[(await window.rattib.info()).platform].commands.latest !== versionCommand) throw new Error('Editing removed a legacy source command');
        card('existing-launch').querySelector('[data-action="launch"]').click();
        await wait(() => document.querySelector('.connected-output')?.textContent.includes('تأكيد إلغاء التثبيت؟ pi uninstall'));
        await wait(async () => Boolean((await window.rattib.presence())['existing-launch'].launchedAt));
        if ((await window.rattib.presence())['existing-launch'].status !== 'unknown') throw new Error('Launching falsely marked an unverified tool installed');
        const preview = document.querySelector('.command-preview');
        if (getComputedStyle(preview).direction !== 'ltr') throw new Error('Command display direction is wrong');
        const terminal = document.querySelector('.xterm');
        const changeLanguage = async language => {
          document.querySelector('[data-ui="settings"]').click();
          await wait(() => document.querySelector('dialog[open] select'));
          const select = document.querySelector('dialog[open] select');
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, language);
          select.dispatchEvent(new Event('change', { bubbles: true }));
          await wait(async () => document.documentElement.lang === language && (await window.rattib.settings()).language === language && !document.querySelector('dialog[open] select').disabled);
          if (!document.querySelector('dialog[open]') || document.querySelector('dialog[open] button[type="submit"]')) throw new Error('Language change required confirmation or closed settings');
          document.querySelector('[data-ui="close-settings"]').click();
          await wait(() => !document.querySelector('dialog[open]'));
        };
        await changeLanguage('ar');
        await changeLanguage('en');
        await changeLanguage('ar');
        if (document.documentElement.dir !== 'rtl') throw new Error('Arabic direction not applied');
        if (document.querySelector('.xterm') !== terminal || getComputedStyle(document.querySelector('.terminal')).direction !== 'ltr') throw new Error('Language change recreated or reversed PTY terminal');
        const arabicLine = [...document.querySelectorAll('.connected-output>div')].find(line => line.textContent.includes('تأكيد إلغاء التثبيت؟'));
        if (!arabicLine || getComputedStyle(arabicLine).direction !== 'rtl') throw new Error('Arabic reading direction failed');
        if ((await window.rattib.settings()).language !== 'ar') throw new Error('UI language preference not saved');
        return { multiVersionUpdateButtons: true, englishUI: true, arabicUI: true, persistedPresence: true, editWithoutDeleting: true, launch: true, readableArabic: true, terminalNotReversed: true, instantLanguage: true, themedScrollbars: true, updaterConfigurationWarning: true, updateConfirmationPlan: true };
      })()`);
      // Drive real Electron keyboard events through the original xterm textarea,
      // while only the connected Arabic display is visible.
      progress('connected-launch');
      focusWindow();
      await contents.executeJavaScript(`(async () => {
        const tools = await window.rattib.list();
        const info = await window.rattib.info();
        tools.find(tool => tool.id === 'existing-launch').profiles[info.platform].commands.launch = 'node ' + JSON.stringify(${JSON.stringify(fixture)}) + ' --arabic';
        await window.rattib.save(tools);
        document.querySelector('[data-tool-id="existing-launch"] [data-action="launch"]').click();
      })()`);
      const waitForText = async value => {
        for (let i = 0; i < 300; i++) {
          if (await contents.executeJavaScript(`document.querySelector('.connected-output')?.textContent.includes(${JSON.stringify(value)}) ?? false`)) return;
          await new Promise(resolve => setTimeout(resolve, 40));
        }
        throw new Error('Connected terminal timed out: ' + value);
      };
      await waitForText('ARROW_MENU');
      progress('connected-display-switch');
      if (process.env.RATTIB_SMOKE_TEST_OCCLUSION === '1') BrowserWindow.fromWebContents(contents)?.hide();
      await contents.executeJavaScript(`(async () => {
        const wait = async predicate => {
          for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
          throw new Error('Timed out switching terminal display');
        };
        const terminal = document.querySelector('.xterm');
        if (!document.querySelector('.arabic-active') || getComputedStyle(document.querySelector('.xterm-screen')).opacity !== '0') throw new Error('Disconnected xterm glyphs still visible');
        if (!document.querySelector('.terminal-selected-row')?.textContent.includes('متابعة')) throw new Error('Menu selection highlight lost in connected display');
        document.querySelector('[data-ui="original-terminal"]').click();
        await wait(() => !document.querySelector('.connected-output'));
        if (document.querySelector('.xterm') !== terminal) throw new Error('Original display switch recreated the terminal');
        document.querySelector('[data-ui="connected-terminal"]').click();
        await wait(() => Boolean(document.querySelector('.connected-output')));
        if (document.querySelector('.xterm') !== terminal) throw new Error('Connected display switch recreated the terminal');
        if (!document.activeElement.classList.contains('xterm-helper-textarea')) throw new Error('Display switch lost keyboard focus');
      })()`);
      const key = keyCode => {
        contents.sendInputEvent({ type: 'keyDown', keyCode });
        contents.sendInputEvent({ type: 'keyUp', keyCode });
      };
      progress('arabic-input');
      focusWindow();
      for (const character of 'مرحبا') contents.sendInputEvent({ type: 'char', keyCode: character });
      await waitForText('ARABIC_INPUT_OK');
      progress('arrow-input');
      key('Down'); key('Return');
      await waitForText('NUMERIC_MENU');
      progress('numeric-input');
      contents.sendInputEvent({ type: 'char', keyCode: '2' });
      key('Return');
      await waitForText('INTERACTIVE_OK');
      ui.connectedArabicKeyboard = true;
      ui.unchangedArabicInput = true;
      ui.connectedMenuSelection = true;
      ui.commandPlaceholders = true;
      ui.noUpdateCheckButton = true;
      if (!confirmations.some(options => options.message === 'Run this command?')) throw new Error('English confirmations were not used');
      if (process.env.RATTIB_SMOKE_SCREENSHOT) writeFileSync(process.env.RATTIB_SMOKE_SCREENSHOT, (await contents.capturePage()).toPNG());
      finish(0, 'SMOKE_OK ' + JSON.stringify({ ...backend, ...ui }));
    } catch (error) { finish(1, error.stack ?? String(error)); }
  });
  contents.on('console-message', details => { if (details.level === 'error') console.error('Renderer:', details.message); });
  contents.on('render-process-gone', (_event, details) => finish(1, 'Renderer exited: ' + details.reason));
});
require('../dist/main.cjs');
