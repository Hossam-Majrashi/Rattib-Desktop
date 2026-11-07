import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Language, TerminalEvent } from '../shared/model';
import { t } from '../shared/i18n';
import { exitLine, hasArabic } from '../shared/terminal-text';
import { records, listeners } from './terminal-bus';

export function TerminalPane({ id, language, arabicPreview }: { id: string; language: Language; arabicPreview: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const enabled = useRef(arabicPreview);
  enabled.current = arabicPreview;
  const refresh = useRef<() => void>(() => undefined);
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => { if (!arabicPreview) setLines([]); else refresh.current(); }, [arabicPreview]);
  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true, fontSize: 14, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
      scrollback: 1000, allowProposedApi: false, allowTransparency: false,
      theme: { background: '#090d14', foreground: '#d8e2ef', cursor: '#62dfb1', selectionBackground: '#33556d' }
    });
    let frame: number | undefined;
    let disposed = false;
    const updatePreview = () => {
      if (frame !== undefined || disposed) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (!enabled.current || disposed) return;
        const buffer = terminal.buffer.active;
        const result: string[] = [];
        const end = Math.min(buffer.length, buffer.baseY + terminal.rows);
        for (let row = Math.max(0, end - 160); row < end; row++) result.push(buffer.getLine(row)?.translateToString(true) ?? '');
        setLines(hasArabic(result) ? result : []);
      });
    };
    refresh.current = updatePreview;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current!);
    const parsed = terminal.onWriteParsed(updatePreview);
    terminal.write(records.get(id)?.output ?? '');
    const input = terminal.onData(data => window.rattib.input(id, data));
    const listener = (event: TerminalEvent) => {
      if ((event.type !== 'data' && event.type !== 'exit') || event.id !== id) return;
      if (event.type === 'data') terminal.write(event.data);
      else terminal.write(exitLine(event.exitCode));
    };
    listeners.add(listener);
    const resize = () => {
      if (!container.current?.clientWidth || !container.current?.clientHeight) return;
      fit.fit(); window.rattib.resize(id, terminal.cols, terminal.rows);
      updatePreview();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current!);
    resize(); terminal.focus();
    return () => {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      refresh.current = () => undefined;
      observer.disconnect(); listeners.delete(listener); parsed.dispose(); input.dispose(); terminal.dispose();
    };
  }, [id]);
  return <>
    <div className="terminal" dir="ltr" ref={container} aria-label={t(language, 'terminalAria')} />
    {arabicPreview && lines.length > 0 && <section className="arabic-preview" aria-label={t(language, 'arabicPreviewTitle')}>
      <h3>{t(language, 'arabicPreviewTitle')}</h3><p className="muted small">{t(language, 'arabicPreviewHint')}</p>
      <div className="readable-output">{lines.map((line, index) => <div dir="auto" key={index}>{line || '\u00a0'}</div>)}</div>
    </section>}
  </>;
}
