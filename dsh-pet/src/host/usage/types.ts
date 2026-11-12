/**
 * 用量查询的契约：四个来源各返回一条，失败不带伪造数字。
 *
 * 不取数、不认识具体服务商的接口。凭据只在各来源的取数函数里出现，本文件不持有。
 * @module dsh-pet/src/host/usage/types
 */

/** 面板上的一个来源。 */
export type UsageSource = 'cursor' | 'codex' | 'grok' | 'clash';

/** 失败原因：没登录、接口失败、当前环境读不了。 */
export type UsageFailureReason = 'credential-missing' | 'fetch-error' | 'unsupported';

/** 一行用量。缺的字段表示这个来源没给，不是 0。 */
export interface UsageRow {
  /** 行名，如「5 小时」或订阅名。 */
  name: string;
  /** 已用量；单位由该来源自己决定，面板优先展示 text。 */
  used?: number;
  /** 额度上限。 */
  limit?: number;
  /** 已用百分比。0 是真的没消耗；可以超过 100。 */
  percent?: number;
  /** 重置时间，ISO 8601。 */
  resetsAt?: string;
  /** 给人看的一行说明。 */
  text?: string;
}

/** 一个来源的结论。 */
export type UsageItem =
  | { source: UsageSource; ok: true; label: string; rows: UsageRow[] }
  | { source: UsageSource; ok: false; reason: UsageFailureReason; message?: string };

/**
 * 取数依赖。测试注入替身；缺省走本机文件与全局 fetch。
 * grokCookie 只驻这次调用的内存，不落日志。
 */
export interface UsageIo {
  /** 发起请求；缺省是全局 fetch。 */
  fetch?: typeof fetch;
  /** 重试间隔；测试里换成空等待。 */
  sleep?: (ms: number) => Promise<void>;
  /** 环境变量；缺省是 process.env。 */
  env?: NodeJS.ProcessEnv;
  /** 用户主目录；缺省是 os.homedir()。 */
  home?: string;
  /** 平台；缺省是 process.platform。 */
  platform?: NodeJS.Platform;
  /** 读文本文件；找不到应抛带 code ENOENT 的错误。 */
  readText?: (filePath: string) => string;
  /** 从 Cursor 的 state.vscdb 读一个键。 */
  readSqlite?: (filePath: string, key: string) => Promise<string | undefined>;
  /** grok.com 的 Cookie 头。空串视为没配置。 */
  grokCookie?: string;
  /** 当前时刻（ms），用来判断本地 token 是否过期。 */
  now?: () => number;
}

/** 取数失败。不用 class 字段：es2020 产物会为此拖进不存在的运行时辅助包。 */
export interface UsageFailure extends Error {
  reason: UsageFailureReason;
}

/** 造一条取数失败。message 不得带凭据或完整 URL。 */
export function usageFailure(reason: UsageFailureReason, message: string): UsageFailure {
  const error = new Error(message) as UsageFailure;
  error.name = 'UsageFailure';
  error.reason = reason;
  return error;
}

/** 是不是本模块抛出的取数失败。 */
export function isUsageFailure(error: unknown): error is UsageFailure {
  return error instanceof Error && error.name === 'UsageFailure' && 'reason' in error;
}

/** 把异常收成一条失败结果。未预期的错误只留「查询失败」，避免把路径或响应体漏进面板。 */
export function usageError(source: UsageSource, error: unknown): UsageItem {
  if (isUsageFailure(error)) return { source, ok: false, reason: error.reason, message: error.message };
  return { source, ok: false, reason: 'fetch-error', message: '查询失败' };
}
