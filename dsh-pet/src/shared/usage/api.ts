/**
 * 用量接口的浏览器侧封装：只拉一次 GET /usage。
 *
 * 不碰 DOM。协议失败与非 JSON 收成一句能直接展示的中文。
 * @module dsh-pet/src/shared/usage/api
 */
import { ROUTE_PATH } from '../constants.ts';
import type { UsageSource } from './types.ts';

/** 用量接口的基址。桌面端改传绝对地址。 */
export const USAGE_PATH = ROUTE_PATH + '/usage';

/** 一行用量。缺的字段表示来源没给。 */
export interface UsageRow {
  name: string;
  used?: number;
  limit?: number;
  percent?: number;
  resetsAt?: string;
  text?: string;
}

/** 一个来源的结论。 */
export type UsageItem =
  | { source: UsageSource; ok: true; label: string; rows: UsageRow[] }
  | { source: UsageSource; ok: false; reason: string; message?: string };

/** 一次拉取的结论。 */
export type UsageResult = { ok: true; items: UsageItem[] } | { ok: false; message: string };

const SOURCES: readonly UsageSource[] = ['cursor', 'codex', 'grok', 'clash'];

function finite(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function readRow(value: unknown): UsageRow | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.name !== 'string' || row.name === '') return undefined;
  return {
    name: row.name,
    used: finite(row.used),
    limit: finite(row.limit),
    percent: finite(row.percent),
    resetsAt: typeof row.resetsAt === 'string' && row.resetsAt !== '' ? row.resetsAt : undefined,
    text: typeof row.text === 'string' && row.text !== '' ? row.text : undefined,
  };
}

/** 把响应里的 items 收成面板用的条目。形状不对的条目丢掉。 */
export function parseUsageItems(value: unknown): UsageItem[] {
  if (!Array.isArray(value)) return [];
  const items: UsageItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (!SOURCES.includes(item.source as UsageSource)) continue;
    const source = item.source as UsageSource;
    if (item.ok === true && typeof item.label === 'string') {
      const rows = Array.isArray(item.rows)
        ? item.rows.map(readRow).filter((row): row is UsageRow => row !== undefined)
        : [];
      items.push({ source, ok: true, label: item.label, rows });
      continue;
    }
    if (item.ok === false && typeof item.reason === 'string') {
      items.push({
        source,
        ok: false,
        reason: item.reason,
        ...(typeof item.message === 'string' && item.message !== '' ? { message: item.message } : {}),
      });
    }
  }
  return items;
}

/** 拉一次用量。失败带可展示的原因。 */
export async function loadUsage(baseUrl = USAGE_PATH): Promise<UsageResult> {
  try {
    const response = await fetch(baseUrl, { method: 'GET', cache: 'no-store' });
    const payload = (await response.json().catch(() => null)) as {
      ok?: unknown;
      items?: unknown;
      message?: unknown;
    } | null;
    if (!response.ok) return { ok: false, message: `请求失败（HTTP ${response.status}）` };
    if (payload === null) return { ok: false, message: '响应不是 JSON' };
    if (payload.ok === false) {
      const message = typeof payload.message === 'string' && payload.message !== '' ? payload.message : '用量查询失败';
      return { ok: false, message };
    }
    return { ok: true, items: parseUsageItems(payload.items) };
  } catch (error) {
    return { ok: false, message: '连不上桌宠服务：' + (error instanceof Error ? error.message : String(error)) };
  }
}
