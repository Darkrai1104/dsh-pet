/**
 * GET /usage：只接管 usage，把 Cookie 交给查询，不把查询异常变成带数字的成功。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { RouteResult } from '../http.ts';
import type { UsageItem } from '../usage/types.ts';
import type { PetRouteDeps } from './types.ts';
import { handleUsageRoutes } from './usage.ts';

const ITEMS: UsageItem[] = [
  { source: 'cursor', ok: false, reason: 'credential-missing', message: 'Cursor 未登录' },
  { source: 'codex', ok: true, label: 'Codex', rows: [{ name: '5 小时', percent: 1 }] },
  { source: 'grok', ok: false, reason: 'credential-missing', message: '未配置' },
  { source: 'clash', ok: true, label: 'Clash', rows: [{ name: '机场', text: '已用 1 B / 4 B' }] },
];

function deps(queryUsage: PetRouteDeps['queryUsage'], readGrokCookie: PetRouteDeps['readGrokCookie']): PetRouteDeps {
  return {
    queryUsage,
    readGrokCookie,
    log: { warn: () => undefined },
  } as unknown as PetRouteDeps;
}

function json(result: RouteResult | undefined): { status: number; obj: Record<string, unknown> } {
  assert.ok(result);
  assert.equal(result.kind, 'json');
  return { status: result.status, obj: result.obj as Record<string, unknown> };
}

describe('handleUsageRoutes', () => {
  test('别的路径：undefined', async () => {
    const result = await handleUsageRoutes(
      deps(
        async () => ITEMS,
        async () => undefined,
      ),
      {
        url: new URL('http://localhost/'),
        rest: 'balance',
        method: 'GET',
      },
    );
    assert.equal(result, undefined);
  });

  test('POST：405', async () => {
    const { status, obj } = json(
      await handleUsageRoutes(
        deps(
          async () => ITEMS,
          async () => undefined,
        ),
        {
          url: new URL('http://localhost/'),
          rest: 'usage',
          method: 'POST',
        },
      ),
    );
    assert.equal(status, 405);
    assert.equal(obj.reason, 'method-not-allowed');
  });

  test('GET：原样返回四个来源，并把 Cookie 传进去', async () => {
    let cookie: string | undefined;
    const { status, obj } = json(
      await handleUsageRoutes(
        deps(
          async (io) => {
            cookie = io.grokCookie;
            return ITEMS;
          },
          async () => 'sso=abc',
        ),
        { url: new URL('http://localhost/'), rest: 'usage', method: 'GET' },
      ),
    );
    assert.equal(status, 200);
    assert.equal(obj.ok, true);
    assert.equal(cookie, 'sso=abc');
    assert.equal((obj.items as unknown[]).length, 4);
  });
});
