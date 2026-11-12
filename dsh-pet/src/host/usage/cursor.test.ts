/**
 * Cursor 用量解析与取数：token 只用于请求，失败结果里不出现它。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cursorUserId, parseCursorUsage, queryCursorUsage } from './cursor.ts';

function jwt(payload: unknown): string {
  return `hdr.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
}

describe('cursorUserId', () => {
  test('从 sub 的竖线后面取出 user_ id', () => {
    assert.equal(cursorUserId(jwt({ sub: 'auth0|user_abc' })), 'user_abc');
  });

  test('没有 user_ 前缀：不拿去拼 Cookie', () => {
    assert.equal(cursorUserId(jwt({ sub: 'auth0|other' })), undefined);
  });
});

describe('parseCursorUsage', () => {
  test('usage-summary：用百分比，不用已经顶满的请求计数', () => {
    const rows = parseCursorUsage({
      membershipType: 'pro',
      billingCycleEnd: '2026-12-01T00:00:00.000Z',
      individualUsage: {
        plan: { used: 2000, limit: 2000, totalPercentUsed: 7.4, autoPercentUsed: 7.4, apiPercentUsed: 1 },
      },
    });
    assert.equal(rows[0]?.text, 'pro');
    assert.equal(rows.find((row) => row.name === '合计')?.percent, 7.4);
    assert.equal(rows.find((row) => row.name === 'Auto')?.percent, 7.4);
    assert.equal(rows.find((row) => row.name === 'API')?.percent, 1);
    assert.equal(JSON.stringify(rows).includes('2000'), false);
    assert.equal(rows.find((row) => row.name === '合计')?.resetsAt, '2026-12-01T00:00:00.000Z');
  });

  test('旧版按模型计数：用请求数算百分比', () => {
    const rows = parseCursorUsage({ 'gpt-4': { numRequests: 25, maxRequestUsage: 50 } });
    assert.equal(rows[0]?.name, 'gpt-4');
    assert.equal(rows[0]?.percent, 50);
  });

  test('认不出的报文：空数组，不编 0', () => {
    assert.deepEqual(parseCursorUsage({ ok: true }), []);
  });
});

describe('queryCursorUsage', () => {
  test('summary 成功：Cookie 带 user id，结果不回显 token', async () => {
    const token = jwt({ sub: 'auth0|user_abc' });
    let cookie = '';
    const item = await queryCursorUsage({
      sleep: async () => undefined,
      readSqlite: async (_file, key) => {
        assert.equal(key, 'cursorAuth/accessToken');
        return token;
      },
      fetch: async (_url, init) => {
        cookie = String((init?.headers as Record<string, string> | undefined)?.Cookie ?? '');
        return Response.json({
          membershipType: 'pro',
          individualUsage: { plan: { totalPercentUsed: 30, used: 3, limit: 10 } },
        });
      },
    });
    assert.equal(cookie.includes('user_abc%3A%3A'), true);
    assert.equal(cookie.includes(token), true);
    assert.equal(item.ok, true);
    if (item.ok) {
      assert.equal(JSON.stringify(item).includes(token), false);
      assert.equal(
        item.rows.some((row) => row.percent === 30),
        true,
      );
    }
  });

  test('读库抛错：fetch-error，不再发请求', async () => {
    let called = false;
    const item = await queryCursorUsage({
      readSqlite: async () => {
        throw Object.assign(new Error('no sqlite'), { code: 'ERR_UNKNOWN_BUILTIN_MODULE' });
      },
      fetch: async () => {
        called = true;
        return Response.json({});
      },
    });
    assert.equal(called, false);
    assert.equal(item.ok, false);
    if (!item.ok) assert.equal(item.reason, 'fetch-error');
  });
});
