import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalEvent } from '../shared/model';

import { records, listeners } from './terminal-bus';
export function TerminalPane({ id }: { id: string }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true, fontSize: 14, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
      scrollback: 1000, allowProposedApi: false, allowTransparency: false,
      theme: { background: '#090d14', foreground: '#d8e2ef', cursor: '#62dfb1', selectionBackground: '#33556d' }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current!);
    terminal.write(records.get(id)?.output ?? '');
    const input = terminal.onData(data => window.rattib.input(id, data));
    const listener = (event: TerminalEvent) => {
      if (event.type === 'version' || event.id !== id) return;
      if (event.type === 'data') terminal.write(event.data);
      else terminal.write('\r\n[انتهى الأمر — exit code: ' + event.exitCode + ']\r\n');
    };
    listeners.add(listener);
    const resize = () => {
      if (!container.current?.clientWidth || !container.current?.clientHeight) return;
      fit.fit();
      window.rattib.resize(id, terminal.cols, terminal.rows);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current!);
    resize();
    terminal.focus();
    return () => { observer.disconnect(); listeners.delete(listener); input.dispose(); terminal.dispose(); };
  }, [id]);
  return <div className="terminal" dir="ltr" ref={container} aria-label="طرفية تفاعلية، استخدم لوحة المفاتيح للاختيار والإدخال" />;
}
