import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const desktopId = 'io.github.HossamMajrashi.RattibDesktop';
function cleanPath(value: string): void {
  if (!value.startsWith('/') || /[\r\n\0]/.test(value)) throw new Error('Invalid desktop shortcut path.');
}
export function desktopEntry(executable: string, icon: string): string {
  cleanPath(executable); cleanPath(icon);
  // Two escaping layers: the desktop string value, then the quoted Exec argument.
  const argument = executable.replace(/["`$\\]/g, '\\$&').replace(/\\/g, '\\\\').replace(/%/g, '%%');
  const iconValue = icon.replace(/\\/g, '\\\\');
  return `[Desktop Entry]\nType=Application\nVersion=1.0\nName=Rattib Desktop\nComment=Manage manually added CLI tools\nExec="${argument}"\nIcon=${iconValue}\nTerminal=false\nCategories=Utility;\nStartupWMClass=${desktopId}\n`;
}
export async function createLinuxShortcut(executable: string, sourceIcon: string, dataDirectory: string): Promise<string> {
  const icon = join(dataDirectory, 'icons', 'hicolor', '512x512', 'apps', 'rattib-desktop.png');
  const application = join(dataDirectory, 'applications', desktopId + '.desktop');
  const content = desktopEntry(executable, icon);
  await mkdir(join(dataDirectory, 'applications'), { recursive: true });
  await mkdir(join(dataDirectory, 'icons', 'hicolor', '512x512', 'apps'), { recursive: true });
  await writeFile(icon, await readFile(sourceIcon), { mode: 0o644 });
  const temporary = application + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, content, { mode: 0o644 });
  await rename(temporary, application);
  return application;
}
