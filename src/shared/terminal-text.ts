// Never reverse or reshape PTY bytes. Only the display uses browser bidi/shaping;
// xterm still parses all output and handles keyboard input in both display modes.
interface ScreenBuffer {
  viewportY: number; baseY: number; cursorY: number;
  getLine(row: number): {
    length?: number;
    translateToString(trimRight?: boolean): string;
    getCell?(column: number): { isInverse(): number } | undefined;
  } | undefined;
}
// Read the visible viewport, not the last output or a stale scrollback transcript.
// A whole line in one text node lets the browser join Arabic letters naturally.
export function readTerminalScreen(buffer: ScreenBuffer, rows: number): { lines: string[]; cursorRow: number; selectedRows: number[] } {
  const selectedRows: number[] = [];
  const lines = Array.from({ length: rows }, (_, row) => {
    const line = buffer.getLine(buffer.viewportY + row);
    // Preserve inverse-video menu selection without splitting Arabic into cell spans.
    for (let column = 0; column < (line?.length ?? 0); column++) {
      if (line?.getCell?.(column)?.isInverse()) { selectedRows.push(row); break; }
    }
    return line?.translateToString(true) ?? '';
  });
  const cursorRow = buffer.baseY + buffer.cursorY - buffer.viewportY;
  return { lines, cursorRow: cursorRow >= 0 && cursorRow < rows ? cursorRow : -1, selectedRows };
}
export function hasArabic(lines: string[]): boolean {
  return lines.some(line => /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u.test(line));
}
export function exitLine(code: number): string { return '\r\n[Process exited - exit code: ' + code + ']\r\n'; }
