/**
 * 用量面板的生命周期：打开即取数，点外面或关闭按钮收起。
 *
 * 不负责定位。显隐由气泡槽决定，面板只在挂上之后拉一次。
 * @module dsh-pet/src/shared/usage/panel
 */
import { loadUsage, USAGE_PATH } from './api.ts';
import { createUsagePanelParts, renderUsage, setUsageBusy } from './render.ts';
import { injectUsageCss } from './styles.ts';

/** 面板挂载参数。 */
export interface UsagePanelOptions {
  /** 接口基址。桌面端传绝对地址。 */
  baseUrl?: string;
  /** 点外面或关闭按钮时调用。 */
  onClose?: () => void;
  /** 这次按下的落点是否该让面板留着。 */
  keepOpenOn?: (target: EventTarget | null) => boolean;
}

/** 面板句柄。 */
export interface UsagePanel {
  el: HTMLElement;
  dispose: () => void;
}

/**
 * 建一个用量面板并开始取数。
 *
 * @param options - 接口基址与关闭回调。
 */
export function createUsagePanel(options: UsagePanelOptions = {}): UsagePanel {
  injectUsageCss();
  const parts = createUsagePanelParts();
  const baseUrl = options.baseUrl ?? USAGE_PATH;
  let disposed = false;

  const reload = async (): Promise<void> => {
    setUsageBusy(parts, true);
    const result = await loadUsage(baseUrl);
    if (disposed) return;
    setUsageBusy(parts, false);
    renderUsage(parts, result);
  };

  const onDocMouseDown = (event: MouseEvent): void => {
    if (disposed) return;
    const target = event.target as Node | null;
    if (target !== null && parts.root.contains(target)) return;
    if (options.keepOpenOn?.(event.target) === true) return;
    options.onClose?.();
  };
  document.addEventListener('mousedown', onDocMouseDown, true);
  parts.closeButton.addEventListener('click', () => options.onClose?.());
  void reload();

  return {
    el: parts.root,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('mousedown', onDocMouseDown, true);
      parts.root.remove();
    },
  };
}
