/**
 * 用量行的结构：有百分比时名称、进度条、百分比、说明排成固定列；没有百分比时不画空进度条。
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { createUsagePanelParts, renderUsage } from './render.ts';

interface FakeNode {
  className: string;
  children: FakeNode[];
}

/** 只记录 class 与子节点，够断言行结构。 */
function installDocument(): () => void {
  const previous = globalThis.document;
  const g = globalThis as { document?: unknown };
  g.document = {
    createElement(): FakeNode & {
      textContent: string;
      style: { width: string };
      hidden: boolean;
      dataset: Record<string, string>;
      type: string;
      append: (...nodes: FakeNode[]) => void;
      appendChild: (node: FakeNode) => FakeNode;
      replaceChildren: (...nodes: FakeNode[]) => void;
      setAttribute: () => void;
      classList: { toggle: () => void };
    } {
      const node = {
        className: '',
        textContent: '',
        style: { width: '' },
        hidden: false,
        dataset: {},
        type: '',
        children: [] as FakeNode[],
        append(...nodes: FakeNode[]) {
          this.children.push(...nodes);
        },
        appendChild(child: FakeNode) {
          this.children.push(child);
          return child;
        },
        replaceChildren(...nodes: FakeNode[]) {
          this.children = nodes;
        },
        setAttribute() {},
        classList: { toggle() {} },
      };
      return node;
    },
  };
  return () => {
    g.document = previous;
  };
}

function classes(node: FakeNode): string[] {
  return node.children.map((child) => child.className);
}

describe('renderUsage —— 行结构', () => {
  let restore = (): void => {};
  afterEach(() => restore());

  test('有百分比：名称、进度条、百分比，说明和重置时间在下一行', () => {
    restore = installDocument();
    const parts = createUsagePanelParts();
    renderUsage(parts, {
      ok: true,
      items: [
        {
          source: 'cursor',
          ok: true,
          label: 'Cursor',
          rows: [{ name: '合计', percent: 7.4, text: '已用', resetsAt: '2026-12-01T00:30:00.000Z' }],
        },
      ],
    });
    const card = (parts.body as unknown as FakeNode).children[0];
    const row = card.children[1].children[0];
    assert.deepEqual(classes(row), [
      'dsh-pet-usage-name',
      'dsh-pet-usage-track',
      'dsh-pet-usage-percent',
      'dsh-pet-usage-detail',
    ]);
    assert.deepEqual(classes(row.children[3]), ['dsh-pet-usage-text', 'dsh-pet-usage-reset']);
  });

  test('没有百分比：名称后直接是说明，不画进度条', () => {
    restore = installDocument();
    const parts = createUsagePanelParts();
    renderUsage(parts, {
      ok: true,
      items: [{ source: 'cursor', ok: true, label: 'Cursor', rows: [{ name: '套餐', text: 'pro' }] }],
    });
    const card = (parts.body as unknown as FakeNode).children[0];
    const row = card.children[1].children[0];
    assert.deepEqual(classes(row), ['dsh-pet-usage-name', 'dsh-pet-usage-value']);
    assert.equal(classes(row).includes('dsh-pet-usage-track'), false);
  });
});
