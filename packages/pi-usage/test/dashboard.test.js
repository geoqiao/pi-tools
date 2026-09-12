import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenMillions, reportDatePreset } from '../src/analytics.js';

test('token display consistently uses millions without rounding nonzero usage to zero', () => {
  for (const [value, expected] of [[0, '0 M'], [1, '0.000001 M'], [999, '0.000999 M'],
    [1000, '0.001 M'], [1234567, '1.234567 M'], [1e9, '1,000 M'], [-1e6, '-1 M'],
    [0.2, '<0.000001 M'], [-0.2, '−<0.000001 M']]) assert.equal(tokenMillions(value), expected);
  for (const value of [null, undefined, NaN, Infinity, -Infinity, '1000']) assert.equal(tokenMillions(value), '—');
});

test('presets use inclusive calendar days ending at report date, not wall clock', () => {
  for (const [preset, from] of [['7', '2026-08-30'], ['30', '2026-08-07'], ['90', '2026-06-08'], ['all', '2026-06-08']]) {
    assert.deepEqual(reportDatePreset('2026-06-08', '2026-09-05', preset), {
      from, to: '2026-09-05', requestedFrom: from, available: true,
    });
  }
  assert.equal(reportDatePreset('2024-01-01', '2024-03-01', '7').from, '2024-02-24');
  assert.equal(reportDatePreset('2025-12-01', '2026-01-03', '7').from, '2025-12-28');
});

test('short snapshots reject unavailable presets instead of silently clipping them', () => {
  assert.deepEqual(reportDatePreset('2026-08-07', '2026-09-05', '90'), {
    from: '2026-06-08', to: '2026-09-05', requestedFrom: '2026-06-08', available: false,
  });
  assert.equal(reportDatePreset('2026-09-05', '2026-09-05', 'all').available, true);
  assert.equal(reportDatePreset('2026-09-05', '2026-09-05', '7').available, false);
});

test('invalid report dates and unknown presets fail explicitly', () => {
  for (const [from, to, preset] of [['2026-02-30', '2026-09-05', '7'], ['bad', '2026-09-05', '7'],
    ['2026-09-06', '2026-09-05', 'all'], ['2026-09-01', '2026-09-05', '0'],
    ['2026-09-01', '2026-09-05', '365']]) assert.throws(() => reportDatePreset(from, to, preset), RangeError);
});
