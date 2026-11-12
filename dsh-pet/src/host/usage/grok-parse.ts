/**
 * Grok 用量响应的解析：JSON（CLI 账单与 REST）和用量页的 gRPC-web 帧。
 *
 * 只认已经公开被用量页使用的字段路径。认不出就返回空数组，不编数字。
 * @module dsh-pet/src/host/usage/grok-parse
 */
import type { UsageRow } from './types.ts';

const PRODUCTS: Record<number, string> = {
  1: 'API',
  2: 'Grok Build',
  3: '其他',
  4: 'Chat',
  5: 'Imagine',
  6: 'Voice',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  if (typeof value === 'boolean' || value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function iso(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  const stamp = finite(value);
  if (stamp === undefined || stamp <= 0) return undefined;
  const ms = stamp < 1_000_000_000_000 ? stamp * 1000 : stamp;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function creditRow(percent: number | undefined, resetsAt: string | undefined): UsageRow | undefined {
  if (percent === undefined) return undefined;
  return { name: '本周期', percent, ...(resetsAt ? { resetsAt } : {}) };
}

function readCredit(source: Record<string, unknown>): UsageRow | undefined {
  const direct = finite(source.creditUsagePercent) ?? finite(source.usedPercent) ?? finite(source.used_percent);
  const period = isRecord(source.currentPeriod) ? source.currentPeriod : undefined;
  const resetsAt = iso(period?.end) ?? iso(source.billingPeriodEnd) ?? iso(source.resetsAt) ?? iso(source.reset_at);
  if (direct !== undefined) return creditRow(direct, resetsAt);
  const used = isRecord(source.onDemandUsed) ? finite(source.onDemandUsed.val) : finite(source.onDemandUsed);
  const cap = isRecord(source.onDemandCap) ? finite(source.onDemandCap.val) : finite(source.onDemandCap);
  if (used === undefined || cap === undefined || cap <= 0) return undefined;
  return creditRow((used / cap) * 100, resetsAt);
}

function readProducts(source: Record<string, unknown>): UsageRow[] {
  const list = source.productUsage ?? source.products ?? source.byProduct;
  if (!Array.isArray(list)) return [];
  const rows: UsageRow[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const name = item.displayName ?? item.name ?? item.id;
    const percent = finite(item.percent) ?? finite(item.percentOfPool);
    if (typeof name !== 'string' || name === '' || percent === undefined) continue;
    rows.push({ name, percent });
  }
  return rows;
}

function readRate(source: Record<string, unknown>): UsageRow | undefined {
  const remaining = finite(source.remainingQueries) ?? finite(source.remaining);
  const total = finite(source.totalQueries) ?? finite(source.limit) ?? finite(source.total);
  if (remaining === undefined || total === undefined || total <= 0) return undefined;
  const used = Math.max(0, total - remaining);
  return {
    name: '快速请求',
    used,
    limit: total,
    percent: (used / total) * 100,
    text: `剩余 ${remaining} / ${total}`,
  };
}

function planName(source: Record<string, unknown>): string | undefined {
  const tier = source.subscription_tier_display ?? source.tier ?? source.plan;
  return typeof tier === 'string' && tier !== '' ? tier : undefined;
}

function readPlan(body: unknown, depth = 0): string | undefined {
  if (depth > 3 || !isRecord(body)) return undefined;
  const own = planName(body);
  if (own) return own;
  const list = Array.isArray(body.subscriptions) ? body.subscriptions : [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const name = item.tier ?? item.plan ?? item.name;
    if (typeof name === 'string' && name !== '' && (item.status === undefined || item.status === 'active')) return name;
  }
  return isRecord(body.data) ? readPlan(body.data, depth + 1) : undefined;
}

/** 把 Grok 的 JSON 用量收成行。认不出返回空数组。 */
export function parseGrokJson(body: unknown): UsageRow[] {
  if (!isRecord(body)) return [];
  const nested = [body, body.config, body.usage, body.data, body.billing].filter(isRecord);
  const rows: UsageRow[] = [];
  const plan = readPlan(body);
  if (plan) rows.push({ name: '套餐', text: plan });
  for (const source of nested) {
    const credit = readCredit(source);
    if (credit) {
      rows.push(credit, ...readProducts(source));
      return rows;
    }
  }
  for (const source of nested) {
    const rate = readRate(source);
    if (rate) {
      rows.push(rate);
      return rows;
    }
  }
  return rows.some((row) => row.percent !== undefined || row.text !== undefined) ? rows : [];
}

interface ProtoField {
  id: number;
  num?: number;
  bytes?: Uint8Array;
}

function readVarint(buf: Uint8Array, offset: number): { value: number; next: number } | undefined {
  let result = 0;
  let shift = 0;
  let index = offset;
  while (index < buf.length && shift < 35) {
    const byte = buf[index];
    index += 1;
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value: result, next: index };
    shift += 7;
  }
  return undefined;
}

function readMessage(buf: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let index = 0;
  while (index < buf.length) {
    const key = readVarint(buf, index);
    if (!key) break;
    index = key.next;
    const id = Math.floor(key.value / 8);
    const wire = key.value % 8;
    if (wire === 0) {
      const value = readVarint(buf, index);
      if (!value) break;
      fields.push({ id, num: value.value });
      index = value.next;
      continue;
    }
    if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (index + size > buf.length) break;
      const view = new DataView(buf.buffer, buf.byteOffset + index, size);
      fields.push({ id, num: wire === 1 ? view.getFloat64(0, true) : view.getFloat32(0, true) });
      index += size;
      continue;
    }
    if (wire === 2) {
      const len = readVarint(buf, index);
      if (!len) break;
      const start = len.next;
      const end = start + len.value;
      if (end > buf.length) break;
      fields.push({ id, bytes: buf.subarray(start, end) });
      index = end;
      continue;
    }
    break;
  }
  return fields;
}

function framePayload(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 5 || bytes[0] !== 0) return bytes;
  const length = new DataView(bytes.buffer, bytes.byteOffset + 1, 4).getUint32(0, false);
  if (length <= 0 || 5 + length > bytes.length) return bytes;
  return bytes.subarray(5, 5 + length);
}

function textOf(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes || bytes.length === 0) return undefined;
  const text = new TextDecoder().decode(bytes);
  return text.includes('\u0000') ? undefined : text;
}

/** 从 GetGrokCreditsConfig 的 gRPC-web 帧里取已用百分比。路径是用量页上观察到的 [1,1] / [1,5] / [1,7]。 */
export function parseGrokGrpc(bytes: Uint8Array): UsageRow[] {
  const outer = readMessage(framePayload(bytes));
  const configBytes = outer.find((field) => field.id === 1 && field.bytes)?.bytes ?? framePayload(bytes);
  const config = readMessage(configBytes);
  const percent = config.find((field) => field.id === 1 && field.num !== undefined)?.num;
  const resetBytes = config.find((field) => field.id === 5 && field.bytes)?.bytes;
  const resetNum = config.find((field) => field.id === 5 && field.num !== undefined)?.num;
  const resetsAt = iso(textOf(resetBytes) ?? resetNum);
  const rows: UsageRow[] = [];
  const credit = creditRow(percent, resetsAt);
  if (credit) rows.push(credit);
  for (const field of config) {
    if (field.id !== 7 || !field.bytes) continue;
    const product = readMessage(field.bytes);
    const kind = product.find((item) => item.id === 1 && item.num !== undefined)?.num;
    const share = product.find((item) => item.id === 2 && item.num !== undefined)?.num;
    if (kind === undefined || share === undefined) continue;
    rows.push({ name: PRODUCTS[kind] ?? '其他', percent: share });
  }
  return rows;
}
