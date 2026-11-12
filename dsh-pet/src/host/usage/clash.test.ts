/**
 * Clash 订阅流量：YAML 只认远程订阅的 extra，缺文件不当成查询失败以外的成功。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { clashRows, formatBytes, parseClashProfiles, queryClashUsage } from './clash.ts';

const YAML = `
current: abc
items:
- uid: local1
  type: local
  name: 本地
  updated: 1
- uid: remote1
  type: remote
  name: 机场
  url: https://example.invalid/sub
  selected:
  - name: AUTO
    now: 香港
  extra:
    upload: 1024
    download: 2048
    total: 8192
    expire: 1800000000
  updated: 1700000000000
  option:
    merge: x
`;

describe('parseClashProfiles', () => {
  test('只保留带流量数字的远程订阅', () => {
    const profiles = parseClashProfiles(YAML);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0]?.name, '机场');
    assert.equal(profiles[0]?.upload, 1024);
    assert.equal(profiles[0]?.download, 2048);
    assert.equal(profiles[0]?.total, 8192);
  });

  test('没有远程订阅：空数组', () => {
    assert.deepEqual(parseClashProfiles('items:\n- type: local\n  name: 本地\n'), []);
  });
});

describe('clashRows', () => {
  test('已用是上传加下载，到期时间按秒级时间戳', () => {
    const [row] = clashRows(parseClashProfiles(YAML));
    assert.equal(row?.percent, ((1024 + 2048) / 8192) * 100);
    assert.equal(row?.text, `已用 ${formatBytes(3072)} / ${formatBytes(8192)}`);
    assert.equal(row?.resetsAt, new Date(1_800_000_000 * 1000).toISOString());
  });
});

describe('queryClashUsage', () => {
  test('配置文件不存在：credential-missing，不带数字', async () => {
    const item = await queryClashUsage({
      readText: () => {
        const error = new Error('missing');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      },
    });
    assert.equal(item.ok, false);
    if (!item.ok) {
      assert.equal(item.reason, 'credential-missing');
      assert.equal(item.message, '没找到 Clash Verge 的订阅配置');
    }
  });
});
