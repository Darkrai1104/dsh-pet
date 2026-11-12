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

function trackOf(percent: number): HTMLDivElement {
  const track = element('div', 'dsh-pet-usage-track');
  const fill = element('div', 'dsh-pet-usage-fill');
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  track.appendChild(fill);
  return track;
}

/** 说明与重置时间同一行；两者都没有时不占位。 */
function detailOf(text: string | undefined, reset: string): HTMLDivElement | null {
  if (!text && reset === '') return null;
  const detail = element('div', 'dsh-pet-usage-detail');
  if (text) detail.appendChild(element('span', 'dsh-pet-usage-text', text));
  if (reset !== '') detail.appendChild(element('span', 'dsh-pet-usage-reset', `重置 ${reset}`));
  return detail;
}

function addRow(list: HTMLElement, row: UsageRow): void {
  const item = element('li', 'dsh-pet-usage-row');
  item.appendChild(element('span', 'dsh-pet-usage-name', row.name));
  const reset = row.resetsAt === undefined ? '' : formatReset(row.resetsAt);
  if (row.percent !== undefined) {
    item.appendChild(trackOf(row.percent));
    item.appendChild(element('span', 'dsh-pet-usage-percent', `${Math.round(row.percent)}%`));
    const detail = detailOf(row.text, reset);
    if (detail) item.appendChild(detail);
  } else if (row.text) {
    item.appendChild(element('span', 'dsh-pet-usage-value', row.text));
    if (reset !== '') {
      const detail = element('div', 'dsh-pet-usage-detail');
      detail.appendChild(element('span', 'dsh-pet-usage-reset', `重置 ${reset}`));
      item.appendChild(detail);
    }
  } else {
    const detail = detailOf(undefined, reset);
    if (detail) item.appendChild(detail);
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
