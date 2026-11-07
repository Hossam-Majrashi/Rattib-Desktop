import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolOperation } from '../src/main/operation.ts';
import { LocalStore } from '../src/main/store.ts';
import { blankProfile } from '../src/shared/model.ts';
import { t } from '../src/shared/i18n.ts';

async function setup(context, action, approved = true) {
  const directory = await mkdtemp(join(tmpdir(), 'rattib-operation-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory, 'linux'); await store.init();
  const tool = { id: 'fixture', name: 'Fixture', profiles: { linux: { ...blankProfile(), commands: { ...blankProfile().commands, install: 'INSTALL', update: 'UPDATE', version: 'VERSION', launch: 'LAUNCH' } } } };
  await store.saveTools([tool]);
  const events = [], children = [], confirmations = [];
  const operation = new ToolOperation({
    tool, profile: tool.profiles.linux, platform: 'linux', requested: action, store,
    send: event => events.push(event), text: (key, values) => t('en', key, values),
    confirm: async (action, kind) => { confirmations.push({ action, kind }); return approved; },
    spawn: (command, cols, rows) => {
      const child = { command, cols, rows, resize(cols, rows) { this.cols = cols; this.rows = rows; }, onData(callback) { this.data = callback; }, onExit(callback) { this.exit = callback; }, kill() { this.exit({ exitCode: 0 }); } };
      children.push(child); return child;
    }
  });
  const complete = async (output = '', exitCode = 0) => { const child = children.at(-1); child.data(output); child.exit({ exitCode }); await operation.completion; };
  return { operation, store, tool, children, events, confirmations, complete };
}
test('every Install click freshly checks existence, including previously verified tools', async context => {
  const s = await setup(context, 'install');
  await s.store.updatePresence(s.tool.id, s.tool.profiles.linux, { status: 'verified', installedVersion: '0.9.0' });
  const run = await s.operation.start(); assert.equal(run.action, 'install'); assert.equal(run.phase, 'version');
  await s.complete('v1.5.0');
  assert.deepEqual(s.children.map(c => c.command), ['VERSION']);
  assert.equal(s.store.state('fixture').installedVersion, '1.5.0');
  assert.equal(s.confirmations.length, 0);
  assert.equal(s.operation.run.running, false);
  assert.ok(s.events.some(e => e.type === 'notice' && e.message.includes('No install command')));
});
test('Check installed version detects and persists presence on its own', async context => {
  const s = await setup(context, 'version'); await s.operation.start(); await s.complete('1.5.0');
  assert.equal(s.store.state('fixture').status, 'verified'); assert.equal(s.store.state('fixture').installedVersion, '1.5.0');
});
test('Update checks presence before modifying, then reads and saves the new version', async context => {
  const s = await setup(context, 'update'); await s.operation.start(); await s.complete('1.5.0');
  assert.deepEqual(s.children.map(c => c.command), ['VERSION', 'UPDATE']);
  assert.deepEqual(s.confirmations, [{ action: 'update', kind: 'command' }]);
  assert.equal(s.operation.process, s.children[1]); assert.equal(s.operation.exited, false);
  await s.complete('Updated'); assert.deepEqual(s.children.map(c => c.command), ['VERSION', 'UPDATE', 'VERSION']);
  await s.complete('1.6.0'); assert.equal(s.store.state('fixture').installedVersion, '1.6.0');
  assert.equal(s.events.filter(e => e.type === 'exit').length, 1);
  assert.ok(s.events.filter(e => e.type === 'phase').every(e => e.id === s.operation.run.id));
});
test('terminal dimensions are retained across check/update/check phases', async context => {
  const s = await setup(context, 'update'); await s.operation.start(); s.operation.resize(132, 38);
  await s.complete('1.5.0'); assert.equal(s.children[1].cols, 132); assert.equal(s.children[1].rows, 38);
  await s.complete('updated'); assert.equal(s.children[2].cols, 132); assert.equal(s.children[2].rows, 38);
  await s.complete('1.6.0');
});
test('close/stop can await cancellation while the first state write is still pending', async context => {
  const s = await setup(context, 'install');
  const updatePresence = s.store.updatePresence.bind(s.store); let release;
  const gate = new Promise(resolve => { release = resolve; });
  s.store.updatePresence = async (...args) => { await gate; return updatePresence(...args); };
  const pending = s.operation.start(); let settled = false;
  void s.operation.completion.then(() => { settled = true; });
  await new Promise(setImmediate); assert.equal(settled, false);
  s.operation.cancel(); release(); await pending; await s.operation.completion;
  assert.equal(s.children.length, 0); assert.equal(s.operation.run.running, false);
});
test('an unverified tool is not updated or installed by the Update button', async context => {
  const s = await setup(context, 'update'); await s.operation.start(); await s.complete('network or PATH error', 127);
  assert.deepEqual(s.children.map(c => c.command), ['VERSION']); assert.equal(s.confirmations.length, 0);
  assert.equal(s.store.state('fixture').status, 'check-failed');
  assert.ok(s.events.some(e => e.type === 'notice' && e.message.includes('No updater or installer')));
});
test('failed verification never installs unless the user explicitly approves uncertainty', async context => {
  const s = await setup(context, 'install', false); await s.operation.start(); await s.complete('not found', 127);
  assert.deepEqual(s.children.map(c => c.command), ['VERSION']);
  assert.deepEqual(s.confirmations, [{ action: 'install', kind: 'unverified-install' }]);
});
test('an explicitly approved installer is followed by real version verification', async context => {
  const s = await setup(context, 'install'); await s.operation.start(); await s.complete('not found', 127);
  assert.deepEqual(s.children.map(c => c.command), ['VERSION', 'INSTALL']);
  await s.complete('installed'); await s.complete('1.5.0');
  assert.equal(s.store.state('fixture').status, 'verified'); assert.equal(s.store.state('fixture').installedVersion, '1.5.0');
});
test('ambiguous output never falsely verifies a tool or triggers an updater', async context => {
  const s = await setup(context, 'update'); await s.operation.start(); await s.complete('tool 1.5.0 dependency 2.0.0');
  assert.equal(s.store.state('fixture').status, 'check-failed'); assert.equal(s.children.length, 1);
});
test('a cancelled update confirmation leaves the verified installation intact', async context => {
  const s = await setup(context, 'update', false); await s.operation.start(); await s.complete('1.5.0');
  assert.equal(s.children.length, 1); assert.equal(s.store.state('fixture').installedVersion, '1.5.0');
});
test('stopping a preflight blocks continuation even if the process exits zero', async context => {
  const s = await setup(context, 'install'); await s.operation.start(); s.operation.cancel(); await s.operation.completion;
  assert.equal(s.children.length, 1); assert.equal(s.confirmations.length, 0); assert.equal(s.operation.run.running, false);
});
test('editing commands during a check aborts the old pending operation', async context => {
  const s = await setup(context, 'update'); await s.operation.start();
  const edited = structuredClone(s.tool); edited.profiles.linux.commands.update = 'DIFFERENT'; await s.store.saveTools([edited]);
  await s.complete('1.5.0'); assert.equal(s.children.length, 1);
  assert.ok(s.events.some(e => e.type === 'error' && e.message.includes('commands changed')));
});
test('failed post-update checks do not invent an installed version', async context => {
  const s = await setup(context, 'update'); await s.operation.start(); await s.complete('1.5.0'); await s.complete('updated'); await s.complete('unclear output');
  assert.equal(s.store.state('fixture').status, 'check-failed'); assert.equal(s.store.state('fixture').installedVersion, undefined);
  assert.ok(s.events.some(e => e.type === 'notice' && e.message.includes('subsequent version check')));
});
for (const action of ['install', 'update']) test(action + ' requires an explicit installed-version command', async context => {
  const s = await setup(context, action); s.tool.profiles.linux.commands.version = ''; await s.store.saveTools([s.tool]);
  await assert.rejects(s.operation.start(), /installed-version command/); assert.equal(s.children.length, 0);
});
test('stopping an updater blocks postflight even when the process traps signals and exits zero', async context => {
  const s = await setup(context, 'update'); await s.operation.start(); await s.complete('1.5.0');
  s.operation.cancel(); await s.operation.completion;
  assert.deepEqual(s.children.map(c => c.command), ['VERSION', 'UPDATE']); assert.equal(s.store.state('fixture').status, 'unknown');
});
test('launching alone does not declare an unverified tool installed', async context => {
  const s = await setup(context, 'launch'); await s.operation.start(); await s.complete('LAUNCH_OK');
  assert.equal(s.store.state('fixture').status, 'unknown'); assert.ok(s.store.state('fixture').launchedAt);
});
