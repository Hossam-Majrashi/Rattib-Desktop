// Run under Electron, with a temporary isolated profile and safe commands only.
const { app, dialog } = require('electron');
const { resolve } = require('node:path');
const profile = process.env.RATTIB_SMOKE_PROFILE;
if (!profile) throw new Error('Use npm run test:smoke for an isolated test profile.');
app.setPath('userData', profile);
dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
let finished = false;
const timeout = setTimeout(() => finish(1, 'SMOKE_TIMEOUT'), 40000);
function finish(code, message) {
  if (finished) return;
  finished = true; clearTimeout(timeout);
  console.log(message);
  // Do not trigger the normal last-window close path in this test.
  app.exit(code);
}
app.on('web-contents-created', (_event, contents) => {
  contents.once('did-finish-load', async () => {
    try {
      const fixture = resolve('tests/interactive-fixture.mjs');
      const result = await contents.executeJavaScript(`(async () => {
        await new Promise(resolve => setTimeout(resolve, 250));
        if (!document.querySelector('h1')?.textContent.includes('Rattib Desktop')) throw new Error('UI not mounted');
        if (typeof window.require !== 'undefined' || typeof window.process !== 'undefined') throw new Error('Renderer Node isolation failed');
        if ((await window.rattib.list()).length) throw new Error('Inventory was not empty');
        const info = await window.rattib.info();
        const profile = { shell: 'auto', commands: {
          install: 'node ' + JSON.stringify(${JSON.stringify(fixture)}), version: 'node ' + JSON.stringify(${JSON.stringify(fixture)}) + ' --version',
          latest: '', update: '', uninstall: ''
        }};
        await window.rattib.save([{ id: 'safe-fixture', name: 'Safe fixture', profiles: { [info.platform]: profile } }]);
        const seen = [];
        const off = window.rattib.onTerminal(e => seen.push(e));
        const wait = async predicate => {
          for (let i = 0; i < 200; i++) {
            if (predicate()) return;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw new Error('Timed out waiting for PTY output: ' + JSON.stringify(seen));
        };
        const run = await window.rattib.run('safe-fixture', 'install');
        const output = () => seen.filter(e => e.id === run.id && e.type === 'data').map(e => e.data).join('');
        await wait(() => output().includes('ARROW_MENU'));
        window.rattib.resize(run.id, 92, 30);
        window.rattib.input(run.id, '\\x1b[B\\r');
        await wait(() => output().includes('NUMERIC_MENU'));
        window.rattib.input(run.id, '2\\r');
        await wait(() => seen.some(e => e.type === 'exit' && e.id === run.id && e.exitCode === 0));
        if (!output().includes('INTERACTIVE_OK')) throw new Error('Interactive fixture failed');
        const versionRun = await window.rattib.run('safe-fixture', 'version');
        await wait(() => seen.some(e => e.type === 'version' && e.version === '1.5.0'));
        await wait(() => seen.some(e => e.type === 'exit' && e.id === versionRun.id && e.exitCode === 0));
        off();
        return { tty: true, arrows: true, numericInput: true, version: '1.5.0', rendererIsolated: true };
      })()`);
      finish(0, 'SMOKE_OK ' + JSON.stringify(result));
    } catch (error) { finish(1, String(error)); }
  });
  contents.on('console-message', details => { if (details.level === 'error') console.error('Renderer:', details.message); });
  contents.on('render-process-gone', (_e, details) => finish(1, 'Renderer exited: ' + details.reason));
});
require('../dist/main.cjs');
