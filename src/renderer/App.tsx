import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { actions, blankProfile, commandIssue, compareVersions, defaultSettings, isPresent, type Action, type AppInfo, type Language, type Platform, type Presence, type Run, type Settings, type Shell, type Tool } from '../shared/model';
import { t, type MessageKey } from '../shared/i18n';
import { exitCode, recordEvent, records } from './terminal-bus';
const TerminalPane = lazy(() => import('./TerminalPane').then(module => ({ default: module.TerminalPane })));
const platformNames: Record<Platform, string> = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };
type SaveOptions = { verify: boolean };

function Editor({ tool, platform, language, onSave, onCancel }: {
  tool: Tool; platform: Platform; language: Language;
  onSave: (tool: Tool, options: SaveOptions) => Promise<void>; onCancel: () => void;
}) {
  const tr = (key: MessageKey) => t(language, key);
  const [draft, setDraft] = useState<Tool>(() => structuredClone(tool));
  const [selected, setSelected] = useState(platform);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const profile = draft.profiles[selected] ?? blankProfile();
  function setCommand(action: Action, value: string) {
    setDraft(prev => ({ ...prev, profiles: { ...prev.profiles, [selected]: { ...profile, commands: { ...profile.commands, [action]: value } } } }));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSaving(true);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const verify = submitter instanceof HTMLButtonElement && submitter.value === 'verify';
    try {
      const profiles = { ...draft.profiles };
      if (!profiles[selected]) profiles[selected] = profile;
      await onSave({ ...draft, name: draft.name.trim(), profiles }, { verify: selected === platform && verify });
    } catch (e) { setError(String(e)); setSaving(false); }
  }
  return <dialog ref={ref} onCancel={onCancel} aria-labelledby="editor-title">
    <form onSubmit={save}>
      <div className="row between"><h2 id="editor-title">{tr('editorTitle')}</h2><button type="button" onClick={onCancel} aria-label={tr('close')}>×</button></div>
      <label>{tr('name')}<input required maxLength={120} dir="auto" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} autoFocus /></label>
      <div className="row">
        <label>{tr('platform')}<select value={selected} onChange={e => setSelected(e.target.value as Platform)}>{Object.entries(platformNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label>{tr('shell')}<select value={profile.shell} onChange={e => setDraft({ ...draft, profiles: { ...draft.profiles, [selected]: { ...profile, shell: e.target.value as Shell } } })}>
          <option value="auto">{tr('defaultShell')}</option>
          {selected === 'win32' ? <><option value="powershell">Windows PowerShell</option><option value="cmd">Command Prompt</option><option value="wsl">{tr('wsl')}</option></> : <><option value="bash">bash</option><option value="zsh">zsh</option></>}
        </select></label>
      </div>
      <p className="muted">{tr('optionalCommands')}</p>
      {actions.filter(a => a !== 'latest').map(a => <label key={a}>{tr(`action.${a}`)}
        <textarea className="command-input" data-command={a} dir="ltr" rows={2} maxLength={16384} spellCheck={false} value={profile.commands[a]} onChange={e => setCommand(a, e.target.value)} placeholder={a === 'version' ? 'tool --version' : a === 'launch' ? 'tool' : ''} />
        {a === 'launch' && <span className="muted small">{tr('launchHint')}</span>}
        {a === 'version' && <span className="muted small">{tr('versionHint')}</span>}
        {a === 'update' && <><span className="muted small">{tr('updateHint')}</span>{commandIssue(profile, 'update') === 'updateMatchesVersion' && <span className="warning" role="alert">{tr('updateMatchesVersion')}</span>}</>}
      </label>)}
      <details><summary>{tr('latestAdvanced')}</summary><p className="muted">{tr('latestHint')}</p>
        <textarea className="command-input" data-command="latest" aria-label={tr('action.latest')} dir="ltr" rows={2} maxLength={16384} value={profile.commands.latest} onChange={e => setCommand('latest', e.target.value)} />
        {commandIssue(profile, 'latest') === 'latestMatchesVersion' && <p className="warning" role="alert">{tr('latestMatchesVersion')}</p>}
      </details>
      <p className="warning">{tr('noSecrets')}</p>
      {error && <p role="alert" className="error" dir="auto">{error}</p>}
      <div className="row end wrap">
        <button type="button" onClick={onCancel}>{tr('cancel')}</button>
        <button type="submit" name="intent" value="verify" disabled={saving || !draft.name.trim() || selected !== platform || !profile.commands.version.trim()}>{tr('saveVerify')}</button>
        <button className="primary" type="submit" name="intent" value="save" disabled={saving || !draft.name.trim()}>{tr(saving ? 'saving' : 'save')}</button>
      </div>
    </form>
  </dialog>;
}
function SettingsDialog({ settings, info, onChange, onCancel, onShortcut }: {
  settings: Settings; info: AppInfo; onChange: (settings: Settings) => Promise<void>; onCancel: () => void; onShortcut: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const tr = (key: MessageKey) => t(settings.language, key);
  useEffect(() => { ref.current?.showModal(); }, []);
  async function change(patch: Partial<Settings>) {
    setSaving(true); setError('');
    try { await onChange({ ...settings, ...patch }); }
    catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }
  return <dialog ref={ref} onCancel={event => { if (saving) event.preventDefault(); else onCancel(); }} aria-labelledby="settings-title">
    <div className="row between"><h2 id="settings-title">{tr('settings')}</h2><button type="button" disabled={saving} onClick={onCancel} aria-label={tr('close')}>×</button></div>
    <label>{tr('language')}<select data-setting="language" value={settings.language} disabled={saving} onChange={e => { void change({ language: e.target.value as Language }); }}><option value="ar">العربية</option><option value="en">English</option></select></label>
    <p className="muted">{tr('languageHint')}</p>
    <label className="checkbox-label"><input type="checkbox" disabled={saving} checked={settings.arabicPreview} onChange={e => { void change({ arabicPreview: e.target.checked }); }} />{tr('arabicPreviewSetting')}</label>
    {info.shortcutAvailable && <section className="association-option"><p className="muted">{tr('shortcutHint')}</p><button type="button" disabled={saving} onClick={() => { void onShortcut().catch(e => setError(String(e))); }}>{tr('shortcut')}</button></section>}
    {error && <p className="error" role="alert" dir="auto">{error}</p>}
    <div className="row end"><button type="button" data-ui="close-settings" className="primary" disabled={saving} onClick={onCancel}>{tr('close')}</button></div>
  </dialog>;
}

export function App() {
  const [info, setInfo] = useState<AppInfo>();
  const [tools, setTools] = useState<Tool[]>([]);
  const [preferences, setPreferences] = useState<Settings>(defaultSettings);
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  const [editing, setEditing] = useState<Tool>();
  const [showSettings, setShowSettings] = useState(false);
  const [run, setRun] = useState<Run>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState('');
  const language = preferences.language;
  const tr = (key: MessageKey, values: Record<string, string | number> = {}) => t(language, key, values);
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'; }, [language]);
  useEffect(() => {
    const unsubscribe = window.rattib.onTerminal(event => {
      recordEvent(event);
      if (event.type === 'exit') setRun(prev => prev?.id === event.id ? { ...prev, running: false } : prev);
      if (event.type === 'phase') setRun(prev => prev?.id === event.id ? { ...prev, phase: event.action } : prev);
      if (event.type === 'notice') setNotice(event.message);
      if (event.type === 'presence') setPresence(prev => ({ ...prev, [event.toolId]: event.state }));
      if (event.type === 'error') setError(event.message);
    });
    let mounted = true;
    Promise.all([window.rattib.info(), window.rattib.list(), window.rattib.settings(), window.rattib.presence()]).then(([i, list, settings, states]) => {
      if (mounted) { setInfo(i); setTools(list); setPreferences(settings); setPresence(states); setReady(true); }
    }).catch(e => { if (mounted) setError(String(e)); });
    return () => { mounted = false; unsubscribe(); };
  }, []);
  async function execute(tool: Tool, action: Action) {
    setError(''); setNotice(''); setBusy(true);
    try {
      const result = await window.rattib.run(tool.id, action);
      if (result) setRun({ ...result, phase: records.get(result.id)?.phase ?? result.phase, running: result.running && exitCode(result.id) === undefined });
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function save(tool: Tool, options: SaveOptions) {
    const next = tools.some(item => item.id === tool.id) ? tools.map(item => item.id === tool.id ? tool : item) : [...tools, tool];
    await window.rattib.save(next);
    setTools(next); setPresence(await window.rattib.presence()); setEditing(undefined);
    try {
      if (options.verify) await execute(tool, 'version');
    } catch (e) { setError(String(e)); }
  }
  async function remove(tool: Tool) {
    if (!window.confirm(tr('deleteQuestion', { name: tool.name }))) return;
    try { const next = tools.filter(item => item.id !== tool.id); await window.rattib.save(next); setTools(next); setPresence(await window.rattib.presence()); }
    catch (e) { setError(String(e)); }
  }
  const locked = busy || Boolean(run?.running);
  const activeTool = tools.find(tool => tool.id === run?.toolId);
  const activeCommand = info && run && activeTool?.profiles[info.platform]?.commands[run.phase];
  const date = (value: number) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
  return <main lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <header>
      <div className="brand"><span className="logo" aria-hidden="true">R</span><div><h1 dir="ltr">Rattib Desktop</h1><p>{tr('subtitle')}</p></div></div>
      <div className="row wrap"><button data-ui="settings" disabled={!ready} onClick={() => setShowSettings(true)}>{tr('settings')}</button><button className="primary" disabled={!ready || locked} onClick={() => setEditing({ id: crypto.randomUUID(), name: '', profiles: { [info!.platform]: blankProfile() } })}>＋ {tr('addTool')}</button></div>
    </header>
    <section className="notice">{tr('notice')}</section>
    {info?.flatpak && <p className="warning">{tr('flatpakWarning')}</p>}
    {error && <p className="error" role="alert" dir="auto">{error}</p>}
    {notice && <p className="notice" role="status" dir="auto">{notice}</p>}
    <div className="row between"><h2>{tr('tools')} <span className="count">{tools.length}</span></h2><input className="search" aria-label={tr('search')} placeholder={tr('search')} value={search} onChange={e => setSearch(e.target.value)} /></div>
    {!ready ? <section className="empty">{tr('loading')}</section> : !tools.length ? <section className="empty"><span className="empty-icon">＋</span><h2>{tr('emptyTitle')}</h2><p>{tr('emptyText')}</p></section> : <section className="cards">
      {tools.filter(tool => tool.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(tool => {
        const profile = info && tool.profiles[info.platform];
        const state = presence[tool.id] ?? { status: 'unknown' };
        const present = isPresent(state);
        const issues = (['update', 'latest'] as const).flatMap(action => {
          const issue = profile?.commands[action].trim() && commandIssue(profile, action);
          return issue ? [issue] : [];
        });
        return <article className="card" key={tool.id} data-tool-id={tool.id}>
          <div className="row between"><h3><bdi>{tool.name}</bdi></h3><span className="badge">{profile ? platformNames[info!.platform] : tr('missingProfile')}</span></div>
          <p className={'presence ' + (present ? 'present' : '')}>{tr(`presence.${state.status}`)}</p>
          <dl>
            <div><dt>{tr('installedVersion')}</dt><dd><bdi dir="ltr">{state.installedVersion ?? tr('notRead')}</bdi></dd></div>
            <div><dt>{tr('latestVersion')}</dt><dd><bdi dir="ltr">{state.latestVersion ?? tr('notChecked')}</bdi></dd></div>
            <div><dt>{tr('updateState')}</dt><dd>{profile?.commands.latest.trim() ? tr(`update.${compareVersions(state.installedVersion, state.latestVersion)}`) : tr('latestNotConfigured')}</dd></div>
            {state.checkedAt && <div><dt>{tr('checkedAt')}</dt><dd>{date(state.checkedAt)}</dd></div>}
            {state.launchedAt && <div><dt>{tr('launchedAt')}</dt><dd>{date(state.launchedAt)}</dd></div>}
          </dl>
          {issues.map(issue => <p className="warning small" key={issue}>{tr(issue)}</p>)}
          <div className="actions">{actions.map(action => { const issue = commandIssue(profile, action); return <button key={action} data-action={action} className={action === 'uninstall' ? 'danger' : action === 'launch' ? 'primary' : ''}
            disabled={locked || Boolean(issue)}
            title={issue ? tr(issue) : tr(`action.${action}`)}
            onClick={() => void execute(tool, action)}>{tr(`action.${action}`)}</button>; })}</div>
          <div className="row card-footer wrap">
            <button className="text-button" data-ui="edit" disabled={locked} onClick={() => setEditing(tool)}>{tr('edit')}</button>
            <button className="text-button" disabled={locked} onClick={() => void remove(tool)}>{tr('deleteCard')}</button>
          </div>
        </article>;
      })}
    </section>}
    {tools.length > 0 && <p className="muted small">{tr('stateNotice')}</p>}
    <section className="terminal-section">
      <div className="row between"><div><h2>{tr('terminalTitle')}</h2><p className="muted">{run ? <><bdi>{run.toolName}</bdi> — {tr(`action.${run.action}`)}{run.phase !== run.action && <> / {tr(`action.${run.phase}`)}</>} · {tr(run.running ? 'running' : 'finished')}</> : tr('terminalHelp')}</p></div>{run?.running && <button className="danger" onClick={() => { void window.rattib.stop(run.id).catch(e => setError(String(e))); }}>{tr('stop')}</button>}</div>
      {activeCommand && <pre className="command-preview" dir="ltr"><code>{activeCommand}</code></pre>}
      {run ? <Suspense fallback={<div className="terminal-placeholder">{tr('openingTerminal')}</div>}><TerminalPane key={run.id} id={run.id} language={language} arabicPreview={preferences.arabicPreview} /></Suspense> : <div className="terminal-placeholder" dir="ltr">$ Ready when you are.</div>}
      <p className="muted small">{tr('terminalFooter')}</p>
    </section>
    <footer><span dir="ltr">Rattib Desktop {info ? 'v' + info.version : ''}</span><span>{tr('local')}</span></footer>
    {editing && info && <Editor tool={editing} platform={info.platform} language={language} onSave={save} onCancel={() => setEditing(undefined)} />}
    {showSettings && info && <SettingsDialog settings={preferences} info={info} onCancel={() => setShowSettings(false)}
      onChange={async settings => {
        const previous = preferences;
        setPreferences(settings);
        try { setPreferences(await window.rattib.saveSettings(settings)); }
        catch (error) { setPreferences(previous); throw error; }
      }}
      onShortcut={async () => { const path = await window.rattib.createShortcut(); if (path) setNotice(tr('shortcutSaved', { path })); }} />}
  </main>;
}
