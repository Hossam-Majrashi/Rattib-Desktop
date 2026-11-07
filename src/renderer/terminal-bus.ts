import type { Action, TerminalEvent } from '../shared/model';
import { exitLine } from '../shared/terminal-text';
export const records = new Map<string, { output: string; exitCode?: number; phase?: Action }>();
export const listeners = new Set<(event: TerminalEvent) => void>();
export function recordEvent(event: TerminalEvent) {
  if (event.type !== 'data' && event.type !== 'exit' && event.type !== 'phase') return;
  const record = records.get(event.id) ?? { output: '' };
  if (event.type === 'data') record.output = (record.output + event.data).slice(-524288);
  else if (event.type === 'phase') record.phase = event.action;
  else {
    record.exitCode = event.exitCode;
    record.output += exitLine(event.exitCode);
  }
  records.set(event.id, record);
  while (records.size > 4) records.delete(records.keys().next().value!);
  for (const listener of listeners) listener(event);
}
export function exitCode(id: string) { return records.get(id)?.exitCode; }
