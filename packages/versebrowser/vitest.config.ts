import { defineConfig } from 'vitest/config';
import { availableParallelism } from 'node:os';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /**
     * 运行级临时根 + 跑完清理：套件里 60+ 处 `mkdtemp(tmpdir(), 'vb-…-')` 不会全部
     * 自删，本机曾累积 1000+ 个 `vb-ws-*` / 386 个 `vb-wait-*`，把真实残骸（如 C83 的
     * 孤儿浏览器目录）混在噪声里。用 globalSetup（主进程，能真正跑完清理）把 temp
     * 指到运行级根并在结束时整棵删除；测试代码无需逐个改。
     */
    globalSetup: ['tests/global-temp-root.ts'],
    // Browser-heavy suites: cap contention; this is not a guarantee against flakes (C79).
    maxWorkers: Math.min(4, availableParallelism()),
    /**
     * P7 干净检出复核发现：冷检出上首次运行会触发 Electron 二进制下载、并同时跑全量
     * 语料校验，个别纯逻辑测试会因此超过 vitest 默认 5s 上限（单独跑 <1s 即通过）。
     * 这里给一个**上限**而不是目标值：30s 只用于吸收冷启动/并发争用，不掩盖真实的慢测试。
     */
    /**
     * C79：整机满载（4 worker）时，经 MCP → facade → upstream worker → Chromium 的一次往返
     * 可能远超 expect.poll() 默认的 1000ms，于是“效果正确但异步生效”的复观测（滚轮滚动由
     * 合成器异步应用）会被误判为失败。这里只放宽复观测允许等待的时间，断言与用例逻辑一行
     * 不改；每次 poll 仍由 testTimeout（30s）封顶。
     */
    expect: { poll: { timeout: 10_000 } },
    testTimeout: 30_000,
  },
});
