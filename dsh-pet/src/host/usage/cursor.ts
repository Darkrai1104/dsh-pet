/**
 * Cursor 订阅用量：从本机 state.vscdb 读登录 token，再问 cursor.com 的用量接口。
 *
 * token 只放进这次请求的 Cookie，不进日志、不落盘。认不出库时按当前 Node 不支持处理。
 * @module dsh-pet/src/host/usage/cursor
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { fetchJson } from './http.ts';
import { isUsageFailure, usageError, usageFailure, type UsageIo, type UsageItem, type UsageRow } from './types.ts';

const SUMMARY_URL = 'https://cursor.com/api/usage-summary';
const TOKEN_KEY = 'cursorAuth/accessToken';
const AUTH_MESSAGE = 'Cursor 登录已过期，请在 Cursor 里重新登录';

/** state.vscdb 的位置。 */
export function cursorDbPath(io: UsageIo = {}): string {
  const env = io.env ?? process.env;
  const home = io.home ?? homedir();
  const platform = io.platform ?? process.platform;
  const tail = join('Cursor', 'User', 'globalStorage', 'state.vscdb');
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), tail);
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', tail);
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), tail);
}

/** 从 JWT 的 sub 里取出 user_ 开头的 id。校验失败返回 undefined，不抛。 */
export function cursorUserId(token: string): string | undefined {
  const part = token.split('.')[1];
  if (!part) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { sub?: unknown };
    if (typeof payload.sub !== 'string' || payload.sub === '') return undefined;
    const id = payload.sub.includes('|') ? payload.sub.slice(payload.sub.lastIndexOf('|') + 1) : payload.sub;
    return id.startsWith('user_') ? id : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  if (typeof value === 'boolean' || value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function iso(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** 把 usage-summary 或旧版 /api/usage 收成行。认不出返回空数组。 */
export function parseCursorUsage(body: unknown): UsageRow[] {
  const root = isRecord(body) ? body : undefined;
  if (!root) return [];
  const rows: UsageRow[] = [];
  if (typeof root.membershipType === 'string' && root.membershipType !== '') {
    rows.push({ name: '套餐', text: root.membershipType });
  }
  const individual = isRecord(root.individualUsage) ? root.individualUsage : root;
  const plan = isRecord(individual.plan) ? individual.plan : isRecord(root.plan) ? root.plan : undefined;
  if (plan) {
    // used/limit 是另一套请求计数，会在百分比还很低时先顶满，不能拿来当套餐余额。
    const resetsAt = iso(root.billingCycleEnd);
    let stamped = false;
    const pushPercent = (name: string, value: unknown): void => {
      const percent = finite(value);
      if (percent === undefined) return;
      rows.push({ name, percent, ...(!stamped && resetsAt ? { resetsAt } : {}) });
      stamped = true;
    };
    pushPercent('合计', plan.totalPercentUsed);
    pushPercent('Auto', plan.autoPercentUsed);
    pushPercent('API', plan.apiPercentUsed);
    if (!stamped) {
      const used = finite(plan.used);
      const limit = finite(plan.limit);
      if (used !== undefined && limit !== undefined && limit > 0) {
        rows.push({ name: '本周期', used, limit, percent: (used / limit) * 100, resetsAt, text: `${used} / ${limit}` });
      }
    }
  }
  if (rows.some((row) => row.percent !== undefined || row.used !== undefined)) return rows;
  for (const [name, value] of Object.entries(root)) {
    if (!isRecord(value)) continue;
    const used = finite(value.numRequests);
    const limit = finite(value.maxRequestUsage);
    if (used === undefined) continue;
    rows.push({
      name,
      used,
      ...(limit === undefined || limit <= 0 ? {} : { limit, percent: (used / limit) * 100 }),
      ...(iso(root.startOfMonth) ? { resetsAt: iso(root.startOfMonth) } : {}),
    });
  }
  return rows;
}

function missingFile(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

async function readToken(io: UsageIo, filePath: string): Promise<string> {
  if (io.readSqlite) {
    const value = await io.readSqlite(filePath, TOKEN_KEY);
    if (!value) throw usageFailure('credential-missing', 'Cursor 未登录');
    return value;
  }
  let sqlite: typeof import('node:sqlite');
  try {
    sqlite = await import('node:sqlite');
  } catch {
    throw usageFailure('unsupported', '当前 Node 不能读取 Cursor 的登录数据库');
  }
  let db: InstanceType<typeof sqlite.DatabaseSync>;
  try {
    db = new sqlite.DatabaseSync(filePath, { readOnly: true, timeout: 2000 });
  } catch (error) {
    if (missingFile(error)) throw usageFailure('credential-missing', '没找到 Cursor 登录状态');
    throw usageFailure('fetch-error', '读不到 Cursor 登录状态');
  }
  try {
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(TOKEN_KEY) as
      { value?: unknown } | undefined;
    const value = row?.value;
    if (typeof value === 'string' && value !== '') return value;
    if (value instanceof Uint8Array && value.length > 0) return new TextDecoder().decode(value);
    throw usageFailure('credential-missing', 'Cursor 未登录');
  } finally {
    db.close();
  }
}

function cookieHeader(userId: string, token: string): string {
  return `WorkosCursorSessionToken=${userId}%3A%3A${token}`;
}

async function loadCursor(io: UsageIo): Promise<UsageRow[]> {
  const token = await readToken(io, cursorDbPath(io));
  const userId = cursorUserId(token);
  if (!userId) throw usageFailure('fetch-error', 'Cursor 登录状态无法识别');
  const headers = {
    Accept: 'application/json',
    Cookie: cookieHeader(userId, token),
    Origin: 'https://cursor.com',
    Referer: 'https://cursor.com/dashboard',
  };
  try {
    const summary = await fetchJson(io, SUMMARY_URL, { headers }, AUTH_MESSAGE);
    const rows = parseCursorUsage(summary);
    if (rows.some((row) => row.percent !== undefined || row.used !== undefined)) return rows;
  } catch (error) {
    if (isUsageFailure(error) && error.reason === 'credential-missing') throw error;
  }
  const legacy = await fetchJson(
    io,
    `https://cursor.com/api/usage?user=${encodeURIComponent(userId)}`,
    { headers },
    AUTH_MESSAGE,
  );
  const rows = parseCursorUsage(legacy);
  if (rows.length === 0) throw usageFailure('fetch-error', '响应里没有用量');
  return rows;
}

/** 查 Cursor 用量。 */
export async function queryCursorUsage(io: UsageIo = {}): Promise<UsageItem> {
  try {
    return { source: 'cursor', ok: true, label: 'Cursor', rows: await loadCursor(io) };
  } catch (error) {
    return usageError('cursor', error);
  }
}
