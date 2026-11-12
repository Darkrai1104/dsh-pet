/**
 * Grok 订阅用量。
 *
 * 有 grok.com 的 Cookie 时走用量页自己的接口：先 POST GetGrokCreditsConfig（gRPC-web，空帧），
 * 会话被拒绝就停止；其它失败再试 REST /rest/usage 与 /rest/rate-limits。
 * 没有 Cookie 时，若 ~/.grok/auth.json 里有未过期的 CLI token，改问 cli-chat-proxy 的账单接口。
 * 不刷新 token，也不把 Cookie 或 token 写进日志。
 * @module dsh-pet/src/host/usage/grok
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { credentialRef } from '@deepseek-ai/dsh-credentials';

import { fetchJson, fetchUsage } from './http.ts';
import { parseGrokGrpc, parseGrokJson } from './grok-parse.ts';
import { isUsageFailure, usageError, usageFailure, type UsageIo, type UsageItem, type UsageRow } from './types.ts';

const GRPC_URL = 'https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig';
const USAGE_URL = 'https://grok.com/rest/usage';
const RATE_URL = 'https://grok.com/rest/rate-limits';
const CLI_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
const EXPIRED = 'Grok 登录已过期';
const MISSING = '未配置 Grok 登录（凭证 GROK_SESSION_COOKIE 或环境变量 DSH_PET_GROK_COOKIE）';

interface CredentialContext {
  credentials?: { resolve?: (ref: unknown) => Promise<{ value?: unknown } | null | undefined> };
}

/** Cookie 只来自环境变量或凭证库，空串视为没有。解析失败也按没有。 */
export async function resolveGrokCookie(ctx: CredentialContext): Promise<string | undefined> {
  const fromEnv = process.env.DSH_PET_GROK_COOKIE;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  try {
    const resolved = await ctx.credentials?.resolve?.(credentialRef('GROK_SESSION_COOKIE'));
    const value = resolved?.value;
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function expired(value: unknown, now: number): boolean {
  if (typeof value === 'string' && value !== '') {
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.getTime() <= now;
  }
  const stamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(stamp) || stamp <= 0) return false;
  const ms = stamp < 1_000_000_000_000 ? stamp * 1000 : stamp;
  return ms <= now;
}

function tokenOf(entry: Record<string, unknown>): string | undefined {
  const direct = entry.key ?? entry.access_token;
  if (typeof direct === 'string' && direct !== '' && !direct.startsWith('xai-')) return direct;
  return undefined;
}

/** 从 grok CLI 的 auth.json 里找一把还没过期的 token。找不到返回 undefined。 */
export function readGrokToken(text: string, now: number): string | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) return undefined;
  const entries = Object.values(raw).filter(isRecord);
  entries.push(raw);
  for (const entry of entries) {
    const token = tokenOf(entry);
    if (!token || expired(entry.expires_at ?? entry.expiresAt, now)) continue;
    return token;
  }
  return undefined;
}

function cookieHeader(cookie: string): string {
  return cookie.includes('=') ? cookie : `sso=${cookie}`;
}

function webHeaders(cookie: string, json: boolean): Record<string, string> {
  return {
    Accept: '*/*',
    Cookie: cookieHeader(cookie),
    Origin: 'https://grok.com',
    Referer: 'https://grok.com/?_s=usage',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function loadGrpc(io: UsageIo, cookie: string): Promise<UsageRow[]> {
  const response = await fetchUsage(io, GRPC_URL, {
    method: 'POST',
    headers: {
      ...webHeaders(cookie, false),
      'Content-Type': 'application/grpc-web+proto',
      'x-grpc-web': '1',
      'x-user-agent': 'connect-es/2.1.1',
    },
    body: new Uint8Array([0, 0, 0, 0, 0]),
  });
  if (response.status === 401 || response.status === 403) throw usageFailure('credential-missing', EXPIRED);
  if (!response.ok) throw usageFailure('fetch-error', `查询失败（HTTP ${response.status}）`);
  return parseGrokGrpc(new Uint8Array(await response.arrayBuffer()));
}

async function loadWeb(io: UsageIo, cookie: string): Promise<UsageRow[]> {
  try {
    const rows = await loadGrpc(io, cookie);
    if (rows.length > 0) return rows;
  } catch (error) {
    if (isUsageFailure(error) && error.reason === 'credential-missing') throw error;
  }
  const usage = await fetchJson(io, USAGE_URL, { headers: webHeaders(cookie, false) }, EXPIRED).catch(
    (error: unknown) => {
      if (isUsageFailure(error) && error.reason === 'credential-missing') throw error;
      return undefined;
    },
  );
  const fromUsage = usage === undefined ? [] : parseGrokJson(usage);
  if (fromUsage.length > 0) return fromUsage;
  const rate = await fetchJson(
    io,
    RATE_URL,
    {
      method: 'POST',
      headers: webHeaders(cookie, true),
      body: JSON.stringify({ modelName: 'grok-4', requestKind: 'DEFAULT' }),
    },
    EXPIRED,
  );
  const rows = parseGrokJson(rate);
  if (rows.length === 0) throw usageFailure('fetch-error', '响应里没有用量');
  return rows;
}

function missingFile(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

async function loadCli(io: UsageIo): Promise<UsageRow[] | undefined> {
  const env = io.env ?? process.env;
  const home = env.GROK_HOME || join(io.home ?? homedir(), '.grok');
  const readText = io.readText ?? ((filePath: string) => readFileSync(filePath, 'utf8'));
  let text: string;
  try {
    text = readText(join(home, 'auth.json'));
  } catch (error) {
    if (missingFile(error)) return undefined;
    throw usageFailure('fetch-error', '读不到 Grok 登录信息');
  }
  const token = readGrokToken(text, io.now?.() ?? Date.now());
  if (!token) return undefined;
  const body = await fetchJson(
    io,
    CLI_URL,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'x-xai-token-auth': 'xai-grok-cli' } },
    EXPIRED,
  );
  const rows = parseGrokJson(body);
  if (rows.length === 0) throw usageFailure('fetch-error', '响应里没有用量');
  return rows;
}

async function loadGrok(io: UsageIo): Promise<UsageRow[]> {
  const cookie = io.grokCookie?.trim() ?? '';
  if (cookie) return loadWeb(io, cookie);
  const cli = await loadCli(io);
  if (cli) return cli;
  throw usageFailure('credential-missing', MISSING);
}

/** 查 Grok 用量。 */
export async function queryGrokUsage(io: UsageIo = {}): Promise<UsageItem> {
  try {
    return { source: 'grok', ok: true, label: 'Grok', rows: await loadGrok(io) };
  } catch (error) {
    return usageError('grok', error);
  }
}
