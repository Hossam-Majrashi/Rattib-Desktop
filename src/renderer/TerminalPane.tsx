import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Language, TerminalEvent } from '../shared/model';
import { t } from '../shared/i18n';
import { exitLine, hasArabic, readTerminalScreen } from '../shared/terminal-text';
import { records, listeners } from './terminal-bus';

export function TerminalPane({ id, language, arabicPreview }: { id: string; language: Language; arabicPreview: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const focus = useRef<() => void>(() => undefined);
  const [original, setOriginal] = useState(false);
  const [screen, setScreen] = useState({ lines: [] as string[], cursorRow: -1, selectedRows: [] as number[], rowHeight: 20 });
  const connected = arabicPreview && !original && screen.lines.length > 0;
  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true, fontSize: 14, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
      scrollback: 1000, allowProposedApi: false, allowTransparency: false,
      theme: { background: '#090d14', foreground: '#d8e2ef', cursor: '#62dfb1', selectionBackground: '#33556d',
        scrollbarSliderBackground: '#3d506880', scrollbarSliderHoverBackground: '#58748fcc', scrollbarSliderActiveBackground: '#63a995cc' }
    });
    let frame: number | undefined;
    let disposed = false;
    const updateScreen = () => {
      if (frame !== undefined || disposed) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (disposed) return;
        const snapshot = readTerminalScreen(terminal.buffer.active, terminal.rows);
        const height = terminal.element?.querySelector('.xterm-screen')?.getBoundingClientRect().height;
        setScreen({ ...snapshot, lines: hasArabic(snapshot.lines) ? snapshot.lines : [], rowHeight: height ? height / terminal.rows : 20 });
      });
    };
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current!);
    focus.current = () => terminal.focus();
    const parsed = terminal.onWriteParsed(updateScreen);
    const scrolled = terminal.onScroll(updateScreen);
    const cursor = terminal.onCursorMove(updateScreen);
    terminal.write(records.get(id)?.output ?? '');
    // xterm remains the PTY parser and keyboard/IME/paste handler in BOTH displays.
    // Never reshape, reverse, or synthesize input sent to the running process.
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
      updateScreen();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current!);
    resize(); terminal.focus();
    return () => {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      focus.current = () => undefined;
      observer.disconnect(); listeners.delete(listener);
      parsed.dispose(); scrolled.dispose(); cursor.dispose(); input.dispose(); terminal.dispose();
    };
  }, [id]);
  return <>
    {arabicPreview && screen.lines.length > 0 && <div className="terminal-display-tools">
      <div className="row wrap">
        <button type="button" data-ui="connected-terminal" aria-pressed={connected} onClick={() => { setOriginal(false); focus.current(); }}>{t(language, 'connectedTerminal')}</button>
        <button type="button" data-ui="original-terminal" aria-pressed={!connected} onClick={() => { setOriginal(true); focus.current(); }}>{t(language, 'originalTerminal')}</button>
      </div>
      <p className="muted small">{t(language, 'arabicPreviewHint')}</p>
    </div>}
    <div className={'terminal-shell' + (connected ? ' arabic-active' : '')} onClick={() => focus.current()}>
      <div className="terminal" dir="ltr" ref={container} aria-label={t(language, 'terminalAria')} />
      {connected && <div className="connected-output" aria-hidden="true" style={{ lineHeight: `${screen.rowHeight}px` }}>
        {screen.lines.map((line, index) => <div dir="auto" className={[index === screen.cursorRow ? 'terminal-cursor-row' : '', screen.selectedRows.includes(index) ? 'terminal-selected-row' : ''].join(' ')} key={index}>{line || '\u00a0'}</div>)}
      </div>}
    </div>
  </>;
}
