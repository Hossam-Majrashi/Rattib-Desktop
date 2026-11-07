// Safe PTY fixture. No installation, network access, or filesystem writes.
if (process.argv.includes('--version')) { console.log('1.5.0'); process.exit(0); }
if (process.argv.includes('--missing')) { console.error('NOT_FOUND_FIXTURE'); process.exit(127); }
if (process.argv.includes('--update-marker')) { console.log('UPDATE_EXECUTED'); process.exit(0); }
if (process.argv.includes('--install-marker')) { console.log('INSTALL_EXECUTED'); process.exit(0); }
if (process.argv.includes('--launch')) { console.log('LAUNCH_OK\nتأكيد إلغاء التثبيت؟ pi uninstall'); process.exit(0); }
if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('NOT_A_TTY'); process.exit(2); }
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write('ARROW_MENU: use down arrow and Enter\r\n');
let stage = 0;
let buffer = '';
process.stdin.on('data', data => {
  buffer += data.toString();
  if (buffer.includes('\x03')) process.exit(130);
  if (stage === 0 && buffer.includes('\x1b[B') && /[\r\n]/.test(buffer)) {
    stage = 1; buffer = ''; process.stdout.write('NUMERIC_MENU: Select option [1/2/3]: ');
  } else if (stage === 1 && /2[\r\n]/.test(buffer)) {
    process.stdout.write('\r\nINTERACTIVE_OK\r\n');
    process.stdin.setRawMode(false); process.exit(0);
  }
});
setTimeout(() => { console.error('FIXTURE_TIMEOUT'); process.exit(3); }, 15000);
