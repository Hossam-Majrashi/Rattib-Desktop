import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStore, presenceFingerprint } from '../src/main/store.ts';
import { blankProfile, isPresent, validateTools, validateSettings } from '../src/shared/model.ts';
import { messages, commandDisplay, t } from '../src/shared/i18n.ts';
import { hasArabic, exitLine } from '../src/shared/terminal-text.ts';
import { desktopEntry, createLinuxShortcut } from '../src/main/desktop.ts';

const tool = () => ({ id: 'existing-tool', name: 'Existing tool', profiles: { linux: { ...blankProfile(), commands: { ...blankProfile().commands, version: 'tool -v', launch: 'tool' } } } });
async function setup(context) {
  const directory = await mkdtemp(join(tmpdir(), 'rattib-store-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory, 'linux'); await store.init();
  return { directory, store };
}

test('migrates 0.1.x tools without losing commands or requiring a launch command', async context => {
  const { directory } = await setup(context);
  const legacy = tool(); delete legacy.profiles.linux.commands.launch;
  await writeFile(join(directory, 'tools.json'), JSON.stringify([legacy]));
  const store = new LocalStore(directory, 'linux'); await store.init();
  assert.equal(store.list()[0].profiles.linux.commands.launch, '');
  assert.equal(store.list()[0].profiles.linux.commands.version, 'tool -v');
  assert.deepEqual(store.presence(), { 'existing-tool': { status: 'unknown' } });
});
test('persists verified installation state and English preferences across restarts', async context => {
  const { directory, store } = await setup(context); const item = tool();
  await store.saveTools([item]);
  await store.updatePresence(item.id, item.profiles.linux, { status: 'verified', installedVersion: '1.5.0', checkedAt: 1234 });
  await store.saveSettings({ language: 'en', arabicPreview: false });
  const reopened = new LocalStore(directory, 'linux'); await reopened.init();
  assert.equal(reopened.state(item.id).installedVersion, '1.5.0');
  assert.ok(isPresent(reopened.state(item.id)));
  assert.deepEqual(reopened.settings(), { language: 'en', arabicPreview: false });
  assert.deepEqual((await readdir(directory)).sort(), ['presence.json', 'settings.json', 'tools.json']);
});
test('editing update commands preserves the card, launch command and verified presence', async context => {
  const { store } = await setup(context); const item = tool();
  await store.saveTools([item]);
  await store.updatePresence(item.id, item.profiles.linux, { status: 'verified', installedVersion: '1.5.0', latestVersion: '1.6.0' });
  const edited = structuredClone(item); edited.profiles.linux.commands.update = 'tool update --new-flag';
  await store.saveTools([edited]);
  assert.equal(store.list()[0].id, item.id);
  assert.equal(store.list()[0].profiles.linux.commands.launch, 'tool');
  assert.equal(store.state(item.id).installedVersion, '1.5.0');
  edited.profiles.linux.commands.latest = 'other-source';
  await store.saveTools([edited]);
  assert.ok(isPresent(store.state(item.id)));
  assert.equal(store.state(item.id).latestVersion, undefined);
});
test('changing detection identity invalidates stale presence and ignores old completions', async context => {
  const { store } = await setup(context); const original = tool();
  await store.saveTools([original]);
  await store.updatePresence(original.id, original.profiles.linux, { status: 'verified', installedVersion: '1.5.0' });
  const edited = structuredClone(original); edited.profiles.linux.commands.version = 'another-tool -v';
  await store.saveTools([edited]);
  await store.updatePresence(original.id, original.profiles.linux, { status: 'verified', installedVersion: '1.5.0' });
  assert.deepEqual(store.state(original.id), { status: 'unknown' });
});
test('manual association persists without pretending a version was verified', async context => {
  const { directory, store } = await setup(context); const item = tool();
  await store.saveTools([item]);
  await store.updatePresence(item.id, item.profiles.linux, { status: 'linked' });
  const reopened = new LocalStore(directory, 'linux'); await reopened.init();
  assert.ok(isPresent(reopened.state(item.id)));
  assert.equal(reopened.state(item.id).installedVersion, undefined);
  await reopened.updatePresence(item.id, item.profiles.linux, { status: 'check-failed' });
  assert.equal(isPresent(reopened.state(item.id)), false);
});
test('presence belongs to the current platform and is not carried to Windows', async context => {
  const { directory, store } = await setup(context); const item = tool(); item.profiles.win32 = blankProfile();
  await store.saveTools([item]); await store.updatePresence(item.id, item.profiles.linux, { status: 'linked' });
  const windows = new LocalStore(directory, 'win32'); await windows.init();
  assert.deepEqual(windows.state(item.id), { status: 'unknown' });
});
test('shell changes alter identity, update-command changes do not', () => {
  const profile = tool().profiles.linux;
  assert.equal(presenceFingerprint(profile), presenceFingerprint({ ...profile, commands: { ...profile.commands, update: 'new command' } }));
  assert.notEqual(presenceFingerprint(profile), presenceFingerprint({ ...profile, shell: 'bash' }));
});
test('rejects prototype-like tool IDs and invalid settings', () => {
  for (const id of ['__proto__', 'constructor', 'prototype']) assert.throws(() => validateTools([{ ...tool(), id }]));
  assert.throws(() => validateSettings({ language: 'other', arabicPreview: true }));
  assert.throws(() => validateSettings({ language: 'en', arabicPreview: 'true' }));
});
test('Arabic and English translations have identical keys and preserve command bytes', () => {
  assert.deepEqual(Object.keys(messages.ar).sort(), Object.keys(messages.en).sort());
  assert.equal(t('en', 'action.launch'), 'Launch');
  assert.equal(t('ar', 'action.uninstall'), 'إلغاء التثبيت');
  const command = 'pi uninstall';
  assert.equal(commandDisplay(command), '\u2066pi uninstall\u2069');
  assert.equal(command, 'pi uninstall');
  assert.ok(hasArabic(['إلغاء التثبيت؟ pi uninstall']));
  assert.equal(hasArabic(['pi uninstall']), false);
  assert.doesNotMatch(exitLine(0), /[\u0600-\u06ff]/);
});
test('portable Linux shortcut has a stable desktop identity and quotes paths without a shell', () => {
  const entry = desktopEntry('/home/user/My Apps/Rattib%Desktop.AppImage', '/home/user/icons/rattib.png');
  assert.match(entry, /Exec="\/home\/user\/My Apps\/Rattib%%Desktop.AppImage"/);
  assert.match(entry, /StartupWMClass=io\.github\.HossamMajrashi\.RattibDesktop/);
  assert.match(entry, /Icon=\/home\/user\/icons\/rattib.png/);
  assert.throws(() => desktopEntry('/tmp/unsafe\nExec=evil', '/tmp/icon.png'));
});
test('shortcut creation copies the icon without starting the application', { skip: process.platform === 'win32' }, async context => {
  const { directory } = await setup(context);
  const source = join(directory, 'source.png'); await writeFile(source, 'test-icon');
  const file = await createLinuxShortcut('/tmp/Rattib Desktop.AppImage', source, join(directory, 'data'));
  assert.ok(file.endsWith('io.github.HossamMajrashi.RattibDesktop.desktop'));
});
