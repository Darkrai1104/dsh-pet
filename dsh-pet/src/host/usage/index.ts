/**
 * 四个用量来源的并行查询。
 *
 * 一个来源失败只影响它自己那一条。结果不写入 /state，只在有人打开面板时现查。
 * @module dsh-pet/src/host/usage/index
 */
import { queryClashUsage } from './clash.ts';
import { queryCodexUsage } from './codex.ts';
import { queryCursorUsage } from './cursor.ts';
import { queryGrokUsage } from './grok.ts';
import { usageError, type UsageIo, type UsageItem, type UsageSource } from './types.ts';

const QUERIES: readonly [(io: UsageIo) => Promise<UsageItem>, UsageSource][] = [
  [queryCursorUsage, 'cursor'],
  [queryCodexUsage, 'codex'],
  [queryGrokUsage, 'grok'],
  [queryClashUsage, 'clash'],
];

/** 同时查 Cursor、Codex、Grok 和 Clash。顺序固定，失败的来源占住自己的位置。 */
export async function queryAllUsage(io: UsageIo = {}): Promise<UsageItem[]> {
  const settled = await Promise.allSettled(QUERIES.map(([query]) => query(io)));
  return settled.map((result, index) => {
    const source = QUERIES[index][1];
    return result.status === 'fulfilled' ? result.value : usageError(source, result.reason);
  });
}
