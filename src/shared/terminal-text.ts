// Never reverse or reshape bytes sent to the PTY. Browser bidi/shaping is used only
// in the read-only HTML panel; the interactive terminal keeps its native grid.
export function hasArabic(lines: string[]): boolean {
  return lines.some(line => /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u.test(line));
}
export function exitLine(code: number): string { return '\r\n[Process exited - exit code: ' + code + ']\r\n'; }
