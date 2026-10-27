// Unit tests for the list rules (no emulator needed: `node --test tests/items.test.js`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isVisible, needsArchive, showAge, isExpiring, sortItems, visibleList, useByLabel, daysUntil,
} from '../public/items.js';

const NOW = new Date(2026, 9, 27, 12, 0).getTime(); // Oct 27 2026, noon local
const H = 36e5, D = 864e5;
const it = (o) => ({ list: 'fridge', name: 'x', added_at: NOW - D, done_at: null, archived_at: null, ...o });

test('crossed-off items show for 24 hours, then need archiving', () => {
  assert.equal(isVisible(it({ done_at: NOW - 23 * H }), NOW), true);
  assert.equal(needsArchive(it({ done_at: NOW - 23 * H }), NOW), false);
  assert.equal(isVisible(it({ done_at: NOW - 25 * H }), NOW), false);
  assert.equal(needsArchive(it({ done_at: NOW - 25 * H }), NOW), true);
  assert.equal(isVisible(it({ archived_at: NOW }), NOW), false);
  assert.equal(needsArchive(it({ done_at: NOW - 30 * H, archived_at: NOW }), NOW), false);
});

test('age marker after more than 7 days, inventory only', () => {
  assert.equal(showAge(it({ added_at: NOW - 7 * D }), NOW), false);
  assert.equal(showAge(it({ added_at: NOW - 8 * D }), NOW), true);
  assert.equal(showAge(it({ list: 'meals', added_at: NOW - 30 * D }), NOW), false);
  assert.equal(showAge(it({ added_at: NOW - 30 * D, done_at: NOW }), NOW), false);
});

test('use-by flag within 2 days or past', () => {
  assert.equal(isExpiring(it({ use_by: '2026-10-30' }), NOW), false);
  assert.equal(isExpiring(it({ use_by: '2026-10-29' }), NOW), true);
  assert.equal(isExpiring(it({ use_by: '2026-10-20' }), NOW), true);
  assert.equal(daysUntil('2026-10-27', NOW), 0);
  assert.equal(useByLabel('2026-10-28', NOW), 'Use by tomorrow');
  assert.equal(useByLabel('2026-10-25', NOW), 'Past use-by (Oct 25)');
});

test('oldest first, crossed-off items at the bottom, flags do not reorder', () => {
  const items = [
    it({ name: 'new', added_at: NOW - 1 * D }),
    it({ name: 'done', added_at: NOW - 20 * D, done_at: NOW - H }),
    it({ name: 'old', added_at: NOW - 9 * D }),
    it({ name: 'expiring', added_at: NOW - 2 * D, use_by: '2026-10-27' }),
  ];
  assert.deepEqual(sortItems(items).map((i) => i.name), ['old', 'expiring', 'new', 'done']);
});

test('visibleList filters by list and hides archived', () => {
  const items = [it({ name: 'a' }), it({ name: 'b', list: 'meals' }), it({ name: 'c', archived_at: NOW })];
  assert.deepEqual(visibleList(items, 'fridge', NOW).map((i) => i.name), ['a']);
});
