/**
 * 用量面板的样式。外框沿用气泡，尺寸锚在气泡字号 --f 上。
 *
 * 高度预算与 usagePanelTopMarginPx 同源：正文区固定最大高度，多出来的行在面板内滚动，
 * 这样桌面窗口不用跟着行数变高。
 * @module dsh-pet/src/shared/usage/styles
 */
import { BUBBLE_OVERLAP_RATIO, resolveFontPx } from '../fonts.ts';
import type { FontConfig } from '../types.ts';

/** 面板根字号相对气泡字号的比例，与待办面板相同。 */
export const USAGE_FONT_SCALE = 0.618;

/** 面板竖向预算（em，基准 = 面板根字号）。 */
export const USAGE_PANEL_METRICS = {
  /** 头部：上下内边距 + 标题行。 */
  head: 0.769 + 0.615 + 1.077 * 1.5,
  /** 可滚动正文的最大高度。 */
  body: 22,
} as const;

/** 面板样式。 */
export const USAGE_CSS = [
  '.dsh-pet-bubble.dsh-pet-usage-bubble,.pet-bubble.dsh-pet-usage-bubble{padding:0;',
  'width:max(220px,calc(var(--f)*16));max-width:calc(100vw - 16px);pointer-events:auto;cursor:default}',
  '.dsh-pet-usage{--t:calc(var(--f)*' + USAGE_FONT_SCALE + ');display:flex;flex-direction:column;',
  'box-sizing:border-box;border-radius:inherit;overflow:hidden;color:#2b2b2b;font-size:var(--t);',
  'line-height:1.5;user-select:none;font-variant-numeric:tabular-nums;',
  "font-family:'Microsoft YaHei UI','Microsoft YaHei','PingFang SC','Segoe UI',system-ui,sans-serif;",
  '}',
  '.dsh-pet-usage *{box-sizing:border-box}',
  '.dsh-pet-usage-head{display:flex;align-items:center;gap:.615em;padding:.769em .923em .615em}',
  '.dsh-pet-usage-title{flex:1;font-size:1.077em;font-weight:600}',
  '.dsh-pet-usage-close{border:none;background:transparent;color:rgba(43,43,43,.5);font-family:inherit;',
  'font-size:1em;line-height:1;padding:.308em .385em;border-radius:.462em;cursor:pointer}',
  '.dsh-pet-usage-close:hover{background:rgba(0,0,0,.06);color:rgba(43,43,43,.9)}',
  '.dsh-pet-usage-status{padding:0 .923em .615em;color:rgba(43,43,43,.62);font-size:.923em}',
  '.dsh-pet-usage-body{display:flex;flex-direction:column;gap:.615em;padding:0 .923em .769em;',
  'max-height:' + USAGE_PANEL_METRICS.body + 'em;overflow:auto}',
  '.dsh-pet-usage-card{display:flex;flex-direction:column;gap:.308em;padding:.462em .615em;',
  'border-radius:.615em;background:rgba(43,43,43,.04)}',
  '.dsh-pet-usage-card-title{margin:0;font-size:1em;font-weight:600}',
  '.dsh-pet-usage-rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.308em}',
  '.dsh-pet-usage-row{display:grid;grid-template-columns:5.5em 1fr 3em;column-gap:.615em;row-gap:.154em;align-items:center}',
  '.dsh-pet-usage-name{min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.dsh-pet-usage-track{flex:1;min-width:4em;height:.462em;border-radius:999px;background:rgba(43,43,43,.12);overflow:hidden}',
  '.dsh-pet-usage-fill{height:100%;border-radius:inherit;background:#4a7dff}',
  '.dsh-pet-usage-percent{text-align:right;white-space:nowrap}',
  '.dsh-pet-usage-value,.dsh-pet-usage-detail{grid-column:2 / 4}',
  '.dsh-pet-usage-detail{display:flex;justify-content:space-between;gap:.615em}',
  '.dsh-pet-usage-percent,.dsh-pet-usage-text,.dsh-pet-usage-reset,.dsh-pet-usage-value,.dsh-pet-usage-empty,.dsh-pet-usage-error{',
  'color:rgba(43,43,43,.72);font-size:.923em}',
  '.dsh-pet-usage-error{margin:0;color:#b42318}',
  '.dsh-pet-usage-empty{margin:0}',
  '.dsh-pet-usage.is-busy .dsh-pet-usage-body{opacity:.55}',
].join('');

let usageCssInjected = false;

/** 注入面板样式。重复调用只插一次。 */
export function injectUsageCss(): void {
  if (usageCssInjected || typeof document === 'undefined') return;
  usageCssInjected = true;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = 'dsh-pet/usage';
  tag.textContent = USAGE_CSS;
  document.head.appendChild(tag);
}

/** 面板占用的窗口上边距（px）。算法与待办面板相同：底边落在宠物盒顶边下方一段。 */
export function usagePanelTopMarginPx(font: FontConfig | undefined, size: number): number {
  const metrics = USAGE_PANEL_METRICS;
  const panelPx = (metrics.head + metrics.body) * resolveFontPx(font, size).bubble * USAGE_FONT_SCALE;
  const overlap = (Number(size) || 0) * BUBBLE_OVERLAP_RATIO;
  return Math.max(0, Math.ceil(panelPx - overlap));
}
