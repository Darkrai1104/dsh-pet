/**
 * Codex 用量：窗口百分比与过期 token 的提示。不刷新 refresh_token。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCodexUsage, queryCodexUsage } from './codex.ts';

const AUTH = JSON.stringify({
  tokens: { access_token: 'access-secret-value', account_id: 'acc', refresh_token: 'refresh-secret-value' },
});

describe('parseCodexUsage', () => {
  test('5 小时窗口和每周窗口', () => {
    const rows = parseCodexUsage({
      plan_type: 'plus',
      rate_limit: {
        primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1_800_000_000 },
        secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1_900_000_000 },
      },
    });
    assert.deepEqual(
      rows.map((row) => row.name),
      ['套餐', '5 小时', '每周'],
    );
    assert.equal(rows[1]?.percent, 12);
    assert.equal(rows[2]?.percent, 40);
  });

  test('没有百分比：空数组', () => {
    assert.deepEqual(parseCodexUsage({ plan_type: 'plus' }), []);
  });
});

describe('queryCodexUsage', () => {
  test('401：提示运行一次 codex，响应里没有 token', async () => {
    const item = await queryCodexUsage({
      sleep: async () => undefined,
      home: 'C:/home',
      readText: () => AUTH,
      fetch: async () => new Response('no', { status: 401 }),
    });
    assert.equal(item.ok, false);
    if (!item.ok) {
      assert.equal(item.reason, 'credential-missing');
      assert.equal(item.message, 'token 过期，请运行一次 codex');
      assert.equal(JSON.stringify(item).includes('access-secret-value'), false);
      assert.equal(JSON.stringify(item).includes('refresh-secret-value'), false);
    }
  });

  test('没有登录文件：credential-missing', async () => {
    const item = await queryCodexUsage({
      readText: () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
    });
    assert.equal(item.ok, false);
    if (!item.ok) assert.equal(item.message, '没找到 Codex 登录信息');
  });
});
