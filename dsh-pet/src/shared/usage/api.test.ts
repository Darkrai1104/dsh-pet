/**
 * 用量响应收窄：坏条目丢掉，不把失败说成有数字。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { loadUsage, parseUsageItems } from './api.ts';
import { formatReset } from './render.ts';

describe('parseUsageItems', () => {
  test('成功和失败条目都留下，来源名不对的丢掉', () => {
    const items = parseUsageItems([
      { source: 'cursor', ok: true, label: 'Cursor', rows: [{ name: '本周期', percent: 10 }, { name: '' }] },
      { source: 'codex', ok: false, reason: 'credential-missing', message: '过期' },
      { source: 'nope', ok: true, label: 'X', rows: [] },
    ]);
    assert.equal(items.length, 2);
    assert.equal(items[0]?.ok, true);
    if (items[0]?.ok) assert.equal(items[0].rows.length, 1);
    assert.equal(items[1]?.ok, false);
  });
});

describe('loadUsage', () => {
  test('HTTP 500：失败文案，不抛', async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = (async () => new Response('no', { status: 500 })) as typeof fetch;
    try {
      const result = await loadUsage('http://127.0.0.1/usage');
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /500/);
    } finally {
      globalThis.fetch = previous;
    }
  });
});

describe('formatReset', () => {
  test('非法时间：空串', () => {
    assert.equal(formatReset('not-a-date'), '');
  });

  test('合法时间：月/日 时:分', () => {
    const label = formatReset('2026-12-01T00:30:00.000Z');
    assert.match(label, /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
  });
});
