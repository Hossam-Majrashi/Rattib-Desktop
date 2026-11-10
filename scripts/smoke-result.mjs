// The parent must report failures even if Electron never reaches the test script
// or blocks in a native startup-error dialog (so its own timeout cannot fire).
export function smokeFailure(child) {
  const stdout = child.stdout ?? '';
  const stderr = child.stderr ?? '';
  const stages = [...stdout.matchAll(/^SMOKE_STAGE (.+)$/gm)];
  const stage = stages.at(-1)?.[1]?.trim() ?? 'electron-startup';
  const reason = child.error?.message ?? `Electron exited with status ${child.status}, signal ${child.signal ?? 'none'}`;
  return { stage, reason, stdout: stdout.slice(-6000), stderr: stderr.slice(-6000) };
}
export function githubError(message) {
  return '::error title=Electron smoke process failed::' + message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
