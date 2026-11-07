import type { TerminalEvent } from '../shared/model';
export const records = new Map<string, { output: string; exitCode?: number }>();
export const listeners = new Set<(event: TerminalEvent) => void>();
export function recordEvent(event: TerminalEvent) {
  if (event.type === 'version') return;
  const record = records.get(event.id) ?? { output: '' };
  if (event.type === 'data') record.output = (record.output + event.data).slice(-524288);
  else {
    record.exitCode = event.exitCode;
    record.output += '\r\n[انتهى الأمر — exit code: ' + event.exitCode + ']\r\n';
  }
  records.set(event.id, record);
  while (records.size > 4) records.delete(records.keys().next().value!);
  for (const listener of listeners) listener(event);
}
export function exitCode(id: string) { return records.get(id)?.exitCode; }
