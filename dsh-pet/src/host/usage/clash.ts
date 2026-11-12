/**
 * Clash Verge Rev 的订阅流量：只读 profiles.yaml 里远程订阅的 extra，不发请求。
 *
 * 数字是 Clash 上次刷新订阅时写下来的，不是此刻现查的。
 * 解析只认这个文件的缩进形状，不是通用 YAML。
 * @module dsh-pet/src/host/usage/clash
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { usageError, usageFailure, type UsageIo, type UsageItem, type UsageRow } from './types.ts';

/** 一条远程订阅的流量。 */
export interface ClashProfile {
  name: string;
  upload: number;
  download: number;
  total: number;
  expire?: number;
  updated?: number;
}

const APP_DIR = 'io.github.clash-verge-rev.clash-verge-rev';

/** profiles.yaml 的位置。Windows 用 APPDATA，macOS / Linux 用各自的用户数据目录。 */
export function clashProfilesPath(io: UsageIo = {}): string {
  const env = io.env ?? process.env;
  const home = io.home ?? homedir();
  const platform = io.platform ?? process.platform;
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), APP_DIR, 'profiles.yaml');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', APP_DIR, 'profiles.yaml');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), APP_DIR, 'profiles.yaml');
}

/** 字节数换成可读单位。 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** 秒或毫秒时间戳换成 ISO；0 和非法值没有重置时间。 */
function toIso(stamp: number | undefined): string | undefined {
  if (stamp === undefined || !Number.isFinite(stamp) || stamp <= 0) return undefined;
  const ms = stamp < 1_000_000_000_000 ? stamp * 1000 : stamp;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** 去掉行尾注释。引号里的 # 保留。 */
function stripComment(line: string): string {
  let quote: '"' | "'" | '' = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && (i === 0 || line[i - 1] === ' ')) return line.slice(0, i);
  }
  return line;
}

function scalar(text: string): string {
  const trimmed = text.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function finite(text: string | undefined): number | undefined {
  if (text === undefined || text === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * 从 profiles.yaml 文本里取出远程订阅。
 * 只收 type: remote 且 extra 里三项流量都是数字的条目。
 */
export function parseClashProfiles(yaml: string): ClashProfile[] {
  const profiles: ClashProfile[] = [];
  let inItems = false;
  let current: Record<string, string> | null = null;
  let inExtra = false;

  const take = (text: string, extra: boolean): void => {
    if (!current) return;
    const split = text.indexOf(':');
    if (split <= 0) return;
    const key = text.slice(0, split).trim();
    const value = scalar(text.slice(split + 1));
    const allowed = extra ? ['upload', 'download', 'total', 'expire'] : ['type', 'name', 'updated'];
    if (allowed.includes(key) && value !== '') current[key] = value;
  };

  const flush = (): void => {
    if (!current || current.type !== 'remote') {
      current = null;
      inExtra = false;
      return;
    }
    const upload = finite(current.upload);
    const download = finite(current.download);
    const total = finite(current.total);
    if (upload !== undefined && download !== undefined && total !== undefined) {
      profiles.push({
        name: current.name || '订阅',
        upload,
        download,
        total,
        expire: finite(current.expire),
        updated: finite(current.updated),
      });
    }
    current = null;
    inExtra = false;
  };

  for (const raw of yaml.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (!inItems) {
      if (indent === 0 && trimmed === 'items:') inItems = true;
      continue;
    }
    // 顶层的 `- uid` 缩进是 0，和 items: 同一列；更深的 `- name` 是 selected 里的嵌套列表，不是新订阅。
    if (trimmed.startsWith('- ')) {
      if (indent > 0) continue;
      flush();
      current = {};
      take(trimmed.slice(2), false);
      continue;
    }
    if (indent === 0) {
      flush();
      inItems = false;
      continue;
    }
    if (!current) continue;
    if (trimmed === 'extra:') {
      inExtra = true;
      continue;
    }
    if (trimmed.endsWith(':') && !trimmed.slice(0, -1).includes(':')) {
      inExtra = false;
      continue;
    }
    take(trimmed, inExtra);
  }
  flush();
  return profiles;
}

/** 订阅流量变成面板行。total 为 0 视为不限量，不画百分比。 */
export function clashRows(profiles: readonly ClashProfile[]): UsageRow[] {
  return profiles.map((profile) => {
    const used = profile.upload + profile.download;
    const limited = profile.total > 0;
    const percent = limited ? (used / profile.total) * 100 : undefined;
    return {
      name: profile.name,
      used,
      ...(limited ? { limit: profile.total, percent } : {}),
      resetsAt: toIso(profile.expire),
      text: `已用 ${formatBytes(used)} / ${limited ? formatBytes(profile.total) : '不限量'}`,
    };
  });
}

function missingFile(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

/** 读本机 Clash Verge 订阅流量。没有配置文件按没登录处理。 */
export async function queryClashUsage(io: UsageIo = {}): Promise<UsageItem> {
  try {
    const readText = io.readText ?? ((filePath: string) => readFileSync(filePath, 'utf8'));
    let yaml: string;
    try {
      yaml = readText(clashProfilesPath(io));
    } catch (error) {
      if (missingFile(error)) throw usageFailure('credential-missing', '没找到 Clash Verge 的订阅配置');
      throw usageFailure('fetch-error', '读不到 Clash 订阅配置');
    }
    const rows = clashRows(parseClashProfiles(yaml));
    if (rows.length === 0)
      return { source: 'clash', ok: true, label: 'Clash', rows: [{ name: '订阅', text: '没有远程订阅' }] };
    return { source: 'clash', ok: true, label: 'Clash', rows };
  } catch (error) {
    return usageError('clash', error);
  }
}
