import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTerminalScreen, hasArabic } from '../src/shared/terminal-text.ts';

const buffer = (lines, viewportY = 0, baseY = viewportY, cursorY = 0) => ({
  viewportY, baseY, cursorY,
  getLine: row => lines[row] === undefined ? undefined : { translateToString: () => lines[row] }
});
test('connected display preserves complete Arabic and mixed command lines without reversal', () => {
  const lines = ['تأكيد إلغاء التثبيت؟ strata uninstall', '  1. متابعة', 'Select option [1/2/3]: '];
  assert.deepEqual(readTerminalScreen(buffer(lines), 3), { lines, cursorRow: 0, selectedRows: [] });
  assert.ok(hasArabic(lines));
  assert.equal(hasArabic(['strata update']), false);
});
test('connected display follows the scrolled viewport, not the last output', () => {
  const screen = readTerminalScreen(buffer(['قديم', 'visible 1', 'visible 2', 'newest'], 1, 3), 2);
  assert.deepEqual(screen, { lines: ['visible 1', 'visible 2'], cursorRow: -1, selectedRows: [] });
});
test('inverse-video selection stays visible without splitting the Arabic line', () => {
  const screen = readTerminalScreen({
    viewportY: 0, baseY: 0, cursorY: 0,
    getLine: () => ({ length: 10, translateToString: () => 'الخيار المحدد', getCell: column => ({ isInverse: () => column === 3 ? 1 : 0 }) })
  }, 1);
  assert.deepEqual(screen.selectedRows, [0]);
  assert.equal(screen.lines[0], 'الخيار المحدد');
});
test('alternate-screen updates replace old lines and preserve empty grid rows', () => {
  assert.deepEqual(readTerminalScreen(buffer(['القائمة الجديدة', ''], 0, 0, 1), 3),
    { lines: ['القائمة الجديدة', '', ''], cursorRow: 1, selectedRows: [] });
});
