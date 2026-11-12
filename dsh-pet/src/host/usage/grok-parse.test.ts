/**
 * Grok 响应解析：JSON 账单与用量页 gRPC-web 帧。认不出就不编数字。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseGrokGrpc, parseGrokJson } from './grok-parse.ts';

function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 127) {
    bytes.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return bytes;
}

function field(id: number, wire: number, payload: number[]): number[] {
  return [...varint(id * 8 + wire), ...payload];
}

function message(id: number, payload: number[]): number[] {
  return field(id, 2, [...varint(payload.length), ...payload]);
}

describe('parseGrokJson', () => {
  test('CLI 账单：已用百分比和周期结束', () => {
    const rows = parseGrokJson({
      config: {
        creditUsagePercent: 35,
        currentPeriod: { end: '2026-12-01T00:00:00.000Z' },
        productUsage: [{ name: 'Chat', percent: 10 }],
      },
    });
    assert.equal(rows.find((row) => row.name === '本周期')?.percent, 35);
    assert.equal(rows.find((row) => row.name === 'Chat')?.percent, 10);
  });

  test('rate-limits：用剩余次数反推已用', () => {
    const rows = parseGrokJson({ remainingQueries: 8, totalQueries: 20 });
    assert.equal(rows[0]?.percent, 60);
    assert.equal(rows[0]?.text, '剩余 8 / 20');
  });

  test('空对象：空数组', () => {
    assert.deepEqual(parseGrokJson({}), []);
  });
});

describe('parseGrokGrpc', () => {
  test('用量页的 [1,1] 百分比、[1,5] 重置时间和 [1,7] 产品', () => {
    const reset = [...Buffer.from('2026-12-01T00:00:00.000Z')];
    const inner = [
      ...field(1, 0, varint(35)),
      ...message(5, reset),
      ...message(7, [...field(1, 0, varint(4)), ...field(2, 0, varint(21))]),
    ];
    const body = message(1, inner);
    const frame = new Uint8Array([0, 0, 0, 0, body.length, ...body]);
    const rows = parseGrokGrpc(frame);
    assert.equal(rows[0]?.percent, 35);
    assert.equal(rows[0]?.resetsAt, '2026-12-01T00:00:00.000Z');
    assert.equal(rows.find((row) => row.name === 'Chat')?.percent, 21);
  });
});
