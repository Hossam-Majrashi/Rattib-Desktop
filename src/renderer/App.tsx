import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { actions, blankProfile, compareVersions, type Action, type AppInfo, type Platform, type Run, type Shell, type Tool } from '../shared/model';
import { exitCode, recordEvent } from './terminal-bus';
const TerminalPane = lazy(() => import('./TerminalPane').then(module => ({ default: module.TerminalPane })));
const labels: Record<Action, string> = { install: 'تثبيت', version: 'قراءة الإصدار', latest: 'تحقق من تحديث', update: 'تحديث', uninstall: 'إلغاء التثبيت' };
const platformNames: Record<Platform, string> = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };
const updateNames = { unknown: 'غير معروفة', equal: 'مطابق لآخر إصدار مُتحقق منه', available: 'تحديث متاح', 'installed-newer': 'المثبت أحدث من المصدر المُتحقق منه', manual: 'تحتاج مقارنة يدوية' };

function Editor({ tool, platform, onSave, onCancel }: { tool: Tool; platform: Platform; onSave: (tool: Tool) => Promise<void>; onCancel: () => void }) {
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
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const profiles = { ...draft.profiles };
      if (!profiles[selected]) profiles[selected] = profile;
      await onSave({ ...draft, name: draft.name.trim(), profiles });
    } catch (e) { setError(String(e)); setSaving(false); }
  }
  return <dialog ref={ref} onCancel={onCancel} aria-labelledby="editor-title">
    <form onSubmit={save}>
      <div className="row between"><h2 id="editor-title">إعداد الأداة</h2><button type="button" onClick={onCancel} aria-label="إغلاق">×</button></div>
      <label>اسم الأداة<input required maxLength={120} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} autoFocus /></label>
      <div className="row">
        <label>النظام<select value={selected} onChange={e => setSelected(e.target.value as Platform)}>{Object.entries(platformNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label>بيئة التنفيذ<select value={profile.shell} onChange={e => setDraft({ ...draft, profiles: { ...draft.profiles, [selected]: { ...profile, shell: e.target.value as Shell } } })}>
          <option value="auto">الافتراضية للنظام</option>
          {selected === 'win32' ? <><option value="powershell">Windows PowerShell</option><option value="cmd">Command Prompt</option><option value="wsl">WSL / bash (يتطلب تثبيته)</option></> : <><option value="bash">bash</option><option value="zsh">zsh</option></>}
        </select></label>
      </div>
      <p className="muted">كل الأوامر اختيارية. ترك الحقل فارغًا يعطّل زره. إعدادات كل نظام مستقلة.</p>
      {actions.filter(a => a !== 'latest').map(a => <label key={a}>{labels[a]}<textarea dir="ltr" rows={2} maxLength={16384} spellCheck={false} value={profile.commands[a]} onChange={e => setCommand(a, e.target.value)} placeholder={a === 'version' ? 'tool --version' : ''} /></label>)}
      <details><summary>متقدم: التحقق من آخر إصدار متاح</summary>
        <p className="muted">أدخل أمرًا موثوقًا يعرض رقم أحدث إصدار، دون تثبيت أو تحديث. لا يستطيع Rattib ضمان أن الأمر للقراءة فقط. يلزم ناتج واضح مثل 1.5.0؛ إذا احتوى أكثر من إصدار فلن يخمّن التطبيق.</p>
        <textarea aria-label="أمر أحدث إصدار" dir="ltr" rows={2} maxLength={16384} value={profile.commands.latest} onChange={e => setCommand('latest', e.target.value)} />
      </details>
      <p className="warning">لا تضع مفاتيح API أو كلمات المرور في الأوامر المحفوظة؛ الإعدادات ملف محلي وليست خزنة أسرار.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="row end"><button type="button" onClick={onCancel}>إلغاء</button><button className="primary" disabled={saving || !draft.name.trim()}>{saving ? 'جارٍ الحفظ…' : 'حفظ الأداة'}</button></div>
    </form>
  </dialog>;
}
export function App() {
  const [info, setInfo] = useState<AppInfo>();
  const [tools, setTools] = useState<Tool[]>([]);
  const [editing, setEditing] = useState<Tool>();
  const [run, setRun] = useState<Run>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState('');
  const [versions, setVersions] = useState<Record<string, { installed?: string; latest?: string }>>({});
  useEffect(() => {
    const unsubscribe = window.rattib.onTerminal(event => {
      recordEvent(event);
      if (event.type === 'exit') setRun(prev => prev?.id === event.id ? { ...prev, running: false } : prev);
      if (event.type === 'version') setVersions(prev => ({ ...prev, [event.toolId]: { ...prev[event.toolId], [event.action === 'version' ? 'installed' : 'latest']: event.version } }));
    });
    let mounted = true;
    Promise.all([window.rattib.info(), window.rattib.list()]).then(([i, t]) => { if (mounted) { setInfo(i); setTools(t); setReady(true); } }).catch(e => { if (mounted) setError(String(e)); });
    return () => { mounted = false; unsubscribe(); };
  }, []);
  async function execute(tool: Tool, action: Action) {
    setError(''); setBusy(true);
    if (action === 'version' || action === 'latest') setVersions(prev => ({ ...prev, [tool.id]: { ...prev[tool.id], [action === 'version' ? 'installed' : 'latest']: undefined } }));
    if (action === 'install' || action === 'update' || action === 'uninstall') setVersions(prev => ({ ...prev, [tool.id]: {} }));
    try {
      const result = await window.rattib.run(tool.id, action);
      if (result) setRun({ ...result, running: result.running && exitCode(result.id) === undefined });
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function save(tool: Tool) {
    const next = tools.some(t => t.id === tool.id) ? tools.map(t => t.id === tool.id ? tool : t) : [...tools, tool];
    await window.rattib.save(next); setTools(next); setEditing(undefined);
    setVersions(prev => ({ ...prev, [tool.id]: {} }));
  }
  async function remove(tool: Tool) {
    if (!window.confirm('حذف بطاقة ' + tool.name + ' من Rattib فقط؟\nهذا لا يلغي تثبيت الأداة.')) return;
    try { const next = tools.filter(t => t.id !== tool.id); await window.rattib.save(next); setTools(next); }
    catch (e) { setError(String(e)); }
  }
  const locked = busy || Boolean(run?.running);
  return <main>
    <header>
      <div className="brand"><span className="logo" aria-hidden="true">R</span><div><h1 dir="ltr">Rattib Desktop</h1><p>أدواتك وأوامرك، في مكان واحد.</p></div></div>
      <button className="primary" disabled={!ready} onClick={() => setEditing({ id: crypto.randomUUID(), name: '', profiles: { [info!.platform]: blankProfile() } })}>＋ إضافة أداة</button>
    </header>
    <section className="notice">أنت تضيف الأدوات وتختار الإجابات. لا فحص تلقائي للجهاز ولا تنفيذ أو تحديث تلقائي. الأوامر التي تشغّلها قد تصل لملفاتك بصلاحيات حسابك.</section>
    {info?.flatpak && <p className="warning">نسخة Flatpak تشغّل أوامرك على النظام المضيف عبر flatpak-spawn. هذا يمنح الأوامر صلاحيات حسابك خارج العزل.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="row between"><h2>أدواتي <span className="count">{tools.length}</span></h2><input className="search" aria-label="ابحث في الأدوات المضافة" placeholder="ابحث في أدواتك…" value={search} onChange={e => setSearch(e.target.value)} /></div>
    {!ready ? <section className="empty">جارٍ تحميل إعدادات Rattib…</section> : !tools.length ? <section className="empty"><span className="empty-icon">＋</span><h2>ابدأ بأول أداة</h2><p>أضف الاسم وأوامر التثبيت والإصدار والتحديث والإزالة.<br/>ستظهر أسئلة الأداة في الطرفية لتجيب عنها بنفسك.</p></section> : <section className="cards">
      {tools.filter(t => t.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(tool => {
        const profile = info && tool.profiles[info.platform];
        const v = versions[tool.id] ?? {};
        return <article className="card" key={tool.id}>
          <div className="row between"><h3 dir="auto">{tool.name}</h3><span className="badge">{profile ? platformNames[info!.platform] : 'غير مُعدّ لهذا النظام'}</span></div>
          <dl><div><dt>الإصدار المثبت</dt><dd dir="ltr">{v.installed ?? 'لم يُقرأ'}</dd></div><div><dt>آخر إصدار من المصدر</dt><dd dir="ltr">{v.latest ?? 'لم يُتحقق منه'}</dd></div><div><dt>حالة التحديث</dt><dd>{profile?.commands.latest.trim() ? updateNames[compareVersions(v.installed, v.latest)] : 'التحقق غير مُعدّ'}</dd></div></dl>
          <div className="actions">{actions.map(a => <button key={a} className={a === 'uninstall' ? 'danger' : ''} disabled={locked || !profile?.commands[a].trim()} title={!profile?.commands[a].trim() ? 'أضف الأمر في إعدادات الأداة أولًا' : undefined} onClick={() => void execute(tool, a)}>{labels[a]}</button>)}</div>
          <div className="row card-footer"><button className="text-button" disabled={locked} onClick={() => setEditing(tool)}>تعديل</button><button className="text-button" disabled={locked} onClick={() => void remove(tool)}>حذف البطاقة فقط</button></div>
        </article>;
      })}
    </section>}
    <section className="terminal-section">
      <div className="row between"><div><h2>الطرفية التفاعلية</h2><p className="muted">{run ? run.toolName + ' — ' + labels[run.action] + ' · ' + (run.running ? 'قيد التنفيذ' : 'انتهى الأمر') : 'ستظهر هنا خيارات التثبيت والإزالة. استخدم الأسهم وEnter أو اكتب الإجابة.'}</p></div>{run?.running && <button className="danger" onClick={() => { void window.rattib.stop(run.id).catch(e => setError(String(e))); }}>إيقاف العملية</button>}</div>
      {run ? <Suspense fallback={<div className="terminal-placeholder">جارٍ فتح الطرفية…</div>}><TerminalPane key={run.id} id={run.id} /></Suspense> : <div className="terminal-placeholder" dir="ltr">$ Ready when you are.</div>}
      <p className="muted small">لا يُحفظ سجل الطرفية على القرص بواسطة Rattib. نجاح الأمر لا يثبت اكتمال التثبيت؛ اقرأ الإصدار للتحقق. الإيقاف لا يتراجع عن التغييرات.</p>
    </section>
    <footer><span dir="ltr">Rattib Desktop {info ? 'v' + info.version : ''}</span><span>محلي · بلا حساب · بلا اشتراك مطلوب</span></footer>
    {editing && info && <Editor tool={editing} platform={info.platform} onSave={save} onCancel={() => setEditing(undefined)} />}
  </main>;
}
