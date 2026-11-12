/**
 * 用量面板的 DOM：一张来源卡片一行用量，失败只显示原因。
 *
 * 外部文本一律走 textContent。不取数、不决定显隐。
 * @module dsh-pet/src/shared/usage/render
 */
import type { UsageItem, UsageRow } from './api.ts';

/** 面板骨架。 */
export interface UsagePanelParts {
  root: HTMLElement;
  body: HTMLDivElement;
  closeButton: HTMLButtonElement;
  status: HTMLDivElement;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 造面板骨架。 */
export function createUsagePanelParts(): UsagePanelParts {
  const root = element('div', 'dsh-pet-usage');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '用量');
  const head = element('div', 'dsh-pet-usage-head');
  const title = element('span', 'dsh-pet-usage-title', '用量');
  const closeButton = element('button', 'dsh-pet-usage-close', '✕');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭用量面板');
  head.append(title, closeButton);
  const status = element('div', 'dsh-pet-usage-status');
  status.hidden = true;
  const body = element('div', 'dsh-pet-usage-body');
  root.append(head, status, body);
  return { root, body, closeButton, status };
}

/** 重置时间收成短日期。非法字符串返回空。 */
export function formatReset(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

function addBar(parent: HTMLElement, percent: number): void {
  const track = element('div', 'dsh-pet-usage-track');
  const fill = element('div', 'dsh-pet-usage-fill');
  const width = Math.max(0, Math.min(100, percent));
  fill.style.width = `${width}%`;
  track.appendChild(fill);
  const label = element('span', 'dsh-pet-usage-percent', `${Math.round(percent)}%`);
  parent.append(track, label);
}

function addRow(list: HTMLElement, row: UsageRow): void {
  const item = element('li', 'dsh-pet-usage-row');
  const name = element('span', 'dsh-pet-usage-name', row.name);
  item.appendChild(name);
  if (row.percent !== undefined) addBar(item, row.percent);
  if (row.text) item.appendChild(element('span', 'dsh-pet-usage-text', row.text));
  if (row.resetsAt) {
    const label = formatReset(row.resetsAt);
    if (label) item.appendChild(element('span', 'dsh-pet-usage-reset', `重置 ${label}`));
  }
  list.appendChild(item);
}

function addCard(parent: HTMLElement, item: UsageItem): void {
  const card = element('section', 'dsh-pet-usage-card');
  const title = item.ok ? item.label : item.source;
  card.appendChild(element('h3', 'dsh-pet-usage-card-title', title));
  if (!item.ok) {
    card.appendChild(element('p', 'dsh-pet-usage-error', item.message || '查询失败'));
    parent.appendChild(card);
    return;
  }
  if (item.rows.length === 0) {
    card.appendChild(element('p', 'dsh-pet-usage-empty', '没有用量数据'));
    parent.appendChild(card);
    return;
  }
  const list = element('ul', 'dsh-pet-usage-rows');
  for (const row of item.rows) addRow(list, row);
  card.appendChild(list);
  parent.appendChild(card);
}

/** 用这次拉取的结果填面板。 */
export function renderUsage(
  parts: UsagePanelParts,
  result: { ok: true; items: UsageItem[] } | { ok: false; message: string },
): void {
  parts.body.replaceChildren();
  if (!result.ok) {
    parts.status.hidden = false;
    parts.status.textContent = result.message;
    return;
  }
  parts.status.hidden = true;
  parts.status.textContent = '';
  if (result.items.length === 0) {
    parts.body.appendChild(element('p', 'dsh-pet-usage-empty', '没有用量数据'));
    return;
  }
  for (const item of result.items) addCard(parts.body, item);
}

/** 请求在途时禁用关闭以外的区域，避免连点叠两次请求。 */
export function setUsageBusy(parts: UsagePanelParts, busy: boolean): void {
  parts.root.classList.toggle('is-busy', busy);
  parts.status.hidden = !busy;
  if (busy) parts.status.textContent = '正在查询…';
}
