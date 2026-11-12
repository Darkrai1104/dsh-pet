/**
 * 四个来源并行：一个失败不影响其余，顺序固定。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { queryAllUsage } from './index.ts';
import { usageFailure } from './types.ts';

describe('queryAllUsage', () => {
  test('Cursor 失败时 Codex、Grok、Clash 仍返回', async () => {
    const item = await queryAllUsage({
      sleep: async () => undefined,
      grokCookie: 'sso=abc',
      home: 'C:/home',
      platform: 'win32',
      env: { APPDATA: 'C:/app' },
      readSqlite: async () => {
        throw usageFailure('credential-missing', 'Cursor 未登录');
      },
      readText: (filePath) => {
        if (filePath.includes('.codex')) {
          return JSON.stringify({ tokens: { access_token: 'tok', account_id: 'acc' } });
        }
        if (filePath.endsWith('profiles.yaml')) {
          return 'items:\n- type: remote\n  name: 机场\n  extra:\n    upload: 1\n    download: 1\n    total: 4\n';
        }
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      fetch: async (url) => {
        const href = String(url);
        if (href.includes('wham/usage')) {
          return Response.json({
            plan_type: 'plus',
            rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1_800_000_000 } },
          });
        }
        if (href.includes('GetGrokCreditsConfig')) return new Response('nope', { status: 404 });
        if (href.includes('grok.com/rest/usage')) return Response.json({ usedPercent: 15 });
        throw new Error('unexpected ' + href);
      },
    });
    assert.deepEqual(
      item.map((entry) => entry.source),
      ['cursor', 'codex', 'grok', 'clash'],
    );
    assert.equal(item[0]?.ok, false);
    assert.equal(item[1]?.ok, true);
    assert.equal(item[2]?.ok, true);
    assert.equal(item[3]?.ok, true);
    if (item[2]?.ok)
      assert.equal(
        item[2].rows.some((row) => row.percent === 15),
        true,
      );
    if (item[3]?.ok) assert.equal(item[3].rows[0]?.name, '机场');
  });
});
