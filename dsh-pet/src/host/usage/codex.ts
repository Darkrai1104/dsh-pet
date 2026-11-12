/**
 * Codex 订阅用量：读 ~/.codex/auth.json 的 access_token，问 chatgpt.com 的用量接口。
 *
 * 不刷新 token。Codex CLI 自己轮换 refresh_token，这里再刷一次可能把它登出。
 * 401 只提示再运行一次 codex。
 * @module dsh-pet/src/host/usage/codex
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { fetchJson } from './http.ts';
import { usageError, usageFailure, type UsageIo, type UsageItem, type UsageRow } from './types.ts';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const EXPIRED = 'token 过期，请运行一次 codex';

/** auth.json 的位置。 */
export function codexAuthPath(io: UsageIo = {}): string {
  return join(io.home ?? homedir(), '.codex', 'auth.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  if (typeof value === 'boolean' || value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** 窗口秒数换成行名。认不出就用调用方给的兜底。 */
function windowName(seconds: number | undefined, fallback: string): string {
  if (seconds === undefined) return fallback;
  if (seconds <= 6 * 3600) return '5 小时';
  if (seconds >= 6 * 86400) return '每周';
  return fallback;
}

function resetIso(value: unknown): string | undefined {
  const stamp = finite(value);
  if (stamp === undefined || stamp <= 0) return undefined;
  const ms = stamp < 1_000_000_000_000 ? stamp * 1000 : stamp;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function readWindow(value: unknown, fallback: string): UsageRow | undefined {
  if (!isRecord(value)) return undefined;
  const percent = finite(value.used_percent) ?? finite(value.usedPercent);
  if (percent === undefined) return undefined;
  const seconds = finite(value.limit_window_seconds) ?? finite(value.limitWindowSeconds);
  const minutes = finite(value.window_minutes) ?? finite(value.windowMinutes);
  return {
    name: windowName(seconds ?? (minutes === undefined ? undefined : minutes * 60), fallback),
    percent,
    resetsAt: resetIso(value.reset_at ?? value.resetAt ?? value.resets_at ?? value.resetsAt),
  };
}

/** 把 wham/usage 收成行。认不出返回空数组。 */
export function parseCodexUsage(body: unknown): UsageRow[] {
  if (!isRecord(body)) return [];
  const rate = isRecord(body.rate_limit) ? body.rate_limit : isRecord(body.rateLimit) ? body.rateLimit : body;
  const rows: UsageRow[] = [];
  const plan = body.plan_type ?? body.planType;
  if (typeof plan === 'string' && plan !== '') rows.push({ name: '套餐', text: plan });
  const primary = readWindow(rate.primary_window ?? rate.primaryWindow, '主窗口');
  const secondary = readWindow(rate.secondary_window ?? rate.secondaryWindow, '每周');
  if (primary) rows.push(primary);
  if (secondary) rows.push(secondary);
  return rows.some((row) => row.percent !== undefined) ? rows : [];
}

interface CodexAuth {
  token: string;
  accountId: string;
}

function readAuth(text: string): CodexAuth | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) return undefined;
  const tokens = isRecord(raw.tokens) ? raw.tokens : raw;
  const token = tokens.access_token;
  const accountId = tokens.account_id ?? raw.account_id;
  if (typeof token !== 'string' || token === '' || typeof accountId !== 'string' || accountId === '') return undefined;
  return { token, accountId };
}

function missingFile(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

async function loadCodex(io: UsageIo): Promise<UsageRow[]> {
  const readText = io.readText ?? ((filePath: string) => readFileSync(filePath, 'utf8'));
  let text: string;
  try {
    text = readText(codexAuthPath(io));
  } catch (error) {
    if (missingFile(error)) throw usageFailure('credential-missing', '没找到 Codex 登录信息');
    throw usageFailure('fetch-error', '读不到 Codex 登录信息');
  }
  const auth = readAuth(text);
  if (!auth) throw usageFailure('credential-missing', 'Codex 未登录');
  const body = await fetchJson(
    io,
    USAGE_URL,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${auth.token}`,
        'ChatGPT-Account-Id': auth.accountId,
      },
    },
    EXPIRED,
  );
  const rows = parseCodexUsage(body);
  if (rows.length === 0) throw usageFailure('fetch-error', '响应里没有用量');
  return rows;
}

/** 查 Codex 用量。 */
export async function queryCodexUsage(io: UsageIo = {}): Promise<UsageItem> {
  try {
    return { source: 'codex', ok: true, label: 'Codex', rows: await loadCodex(io) };
  } catch (error) {
    return usageError('codex', error);
  }
}
