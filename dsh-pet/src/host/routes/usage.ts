/**
 * 用量查询入口：GET /usage 现查 Cursor、Codex、Grok 与 Clash，不写轮询状态。
 *
 * 某一个来源失败只出现在它自己的条目里。凭据由 queryUsage 的入参带入，本模块不读文件。
 * @module dsh-pet/src/host/routes/usage
 */
import type { RouteResult } from '../http.ts';
import { internalError, methodNotAllowed, okResult } from './result.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';

/** 用量领域：未命中返回 undefined，命中返回应答。 */
export async function handleUsageRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { method, rest } = input;
  if (rest === 'usage') {
    if (method !== 'GET') return methodNotAllowed();
    let grokCookie: string | undefined;
    try {
      grokCookie = await deps.readGrokCookie();
    } catch {
      grokCookie = undefined;
    }
    try {
      const items = await deps.queryUsage({ grokCookie });
      return okResult({ ok: true, items });
    } catch (error) {
      deps.log.warn(`[dsh-pet] 用量查询失败：${error instanceof Error ? error.name : 'error'}`);
      return internalError();
    }
  }
  return undefined;
}
