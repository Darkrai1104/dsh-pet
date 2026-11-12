/**
 * 用量面板的气泡外壳：把共享面板塞进气泡槽。
 *
 * 只做挂载与卸载。面板本体在 shared/usage/panel。
 * @module dsh-pet/src/client/usage-bubble
 */
import { createUsagePanel } from '../shared/usage/panel.ts';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';

/** 注入的 react 能力。 */
export interface UsageBubbleRuntime {
  h: typeof jsx;
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
}

/** 面板气泡的 props。 */
export interface UsageBubbleProps {
  on: boolean;
  onClose: () => void;
}

/**
 * 制造用量面板气泡组件。
 *
 * @param rt - 注入的 react 能力。
 */
export function makeUsageBubble(rt: UsageBubbleRuntime) {
  const { h, useRef, useEffect } = rt;

  return function UsageBubble({ on, onClose }: UsageBubbleProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
      const host = hostRef.current;
      if (host === null) return;
      const panel = createUsagePanel({
        onClose: () => closeRef.current(),
        keepOpenOn: (target) => target instanceof Element && target.closest('.dsh-pet-hit') !== null,
      });
      host.appendChild(panel.el);
      return () => panel.dispose();
    }, []);

    return h('div', {
      ref: hostRef,
      className: 'dsh-pet-bubble dsh-pet-usage-bubble' + (on ? ' is-on' : ''),
    });
  };
}
