import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { formatDate, convertDisplayToInputDate } from '../src/formatting.js';

const original = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function extract(start, end, includeEnd = 0) {
  const a = original.indexOf(start);
  const b = original.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'original implementation must be found');
  return original.slice(a, b + includeEnd).trim();
}
const originalFormat = vm.runInNewContext('(' + extract('const formatDate = (str) => {', '\n};', 3).replace(/^const formatDate = /, '').replace(/;\s*$/, '') + ')');
// Evaluating the original function declaration as an expression avoids any globals from app.js.
const originalConvert = vm.runInNewContext('(' + extract('function convertDisplayToInputDate(dStr) {', '\nfunction loadRecentTransactions') + ')');

test('formatDate keeps original application behavior', () => {
  const inputs = [undefined, null, '', '2026-10-05', '05/10/2026',
    '2026-1-2', ' 2026-01-01 ', "'2026-01-01", 'abc',
    '5/10/2026', 0, 2026, '2026-12-31T00:00:00', 'đã thanh toán'];
  for (const input of inputs) assert.equal(formatDate(input), originalFormat(input), String(input));
});

test('convertDisplayToInputDate keeps original application behavior', () => {
  const inputs = [undefined, null, '', '01/02/2025', '1/2/2025',
    '2026-01-02', 'a/b/c', ' 05/09/2026 ', 'a/b', 'a/b/c/d'];
  for (const input of inputs) assert.equal(convertDisplayToInputDate(input), originalConvert(input), String(input));
});
