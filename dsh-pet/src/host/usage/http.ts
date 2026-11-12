/**
 * 用量请求的超时与重试。
 *
 * 超时与余额取数相同（20s）：这些接口都在境外。重试只留 1 次，四个来源又是并行的，
 * 再按余额那条连试 4 次，一次点击要等一分钟以上。
 * 不解析响应体：HTTP 错误由调用方看状态码，这里只在连不上时重试。
 * @module dsh-pet/src/host/usage/http
 */
import { usageFailure, type UsageIo } from './types.ts';

/** 单次请求超时（ms）。 */
const TIMEOUT_MS = 20_000;
/** 失败后的重试次数。 */
const RETRIES = 1;
/** 重试间隔（ms）。 */
const GAP_MS = 800;

/** 带超时地请求一次；网络失败重试，HTTP 非 2xx 原样返回。 */
export async function fetchUsage(io: UsageIo, url: string, init: RequestInit): Promise<Response> {
  const fetchImpl = io.fetch ?? fetch;
  const sleep = io.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      last = error;
      if (attempt < RETRIES) await sleep(GAP_MS);
    }
  }
  throw last instanceof Error ? last : usageFailure('fetch-error', '查询失败');
}

/**
 * 请求并解析 JSON。401/403 或登录页用 authMessage，这段话不得包含凭据。
 */
export async function fetchJson(io: UsageIo, url: string, init: RequestInit, authMessage: string): Promise<unknown> {
  const response = await fetchUsage(io, url, init);
  const text = await response.text();
  if (response.status === 401 || response.status === 403 || text.trim().startsWith('<')) {
    throw usageFailure('credential-missing', authMessage);
  }
  if (!response.ok) throw usageFailure('fetch-error', `查询失败（HTTP ${response.status}）`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw usageFailure('fetch-error', '响应不是 JSON');
  }
}
