/**
 * 运行级临时根（收尾卫生，2026-10-04）。
 *
 * 背景：套件里 60+ 个测试用 `mkdtemp(join(tmpdir(), 'vb-…-'))` 建 scratch 目录，多数
 * 只删自己那部分（或不删）。实测：单跑两个文件就在系统 temp 留下 2 个新 `vb-wait-*`；
 * 本机累积到 **1000+ 个 `vb-ws-*` / 386 个 `vb-wait-*`**（跨 9/27–10/4）。
 *
 * 危害不是磁盘占用，而是**掩盖真实残骸**：真正的孤儿浏览器目录（C83 那次泄漏）
 * 混在同一堆噪声里，人工排查时看不出来。
 *
 * 做法：用 **globalSetup**（跑在 vitest 主进程，且 worker 在其之后创建、会继承 env）
 * 把 temp 指到一个运行级根，跑完整棵删除。
 *
 * 为什么不用 `setupFiles`：那是在 **worker 线程**里执行的，worker 结束时由 vitest
 * 直接终止，`process.on('exit')` 不会触发（实测清理无效、退出回调一次都没跑）。
 * 也不用 `afterAll`：同一 worker 会跑多个测试文件，第一个文件的 afterAll 删掉根目录后，
 * 后续文件的 `mkdtemp` 会失败。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let runRoot: string | undefined;

export async function setup(): Promise<void> {
  // 必须在覆盖前取系统 temp，否则运行级根会建在自己里面。
  runRoot = mkdtempSync(join(tmpdir(), 'vb-test-run-'));
  process.env.TEMP = runRoot;
  process.env.TMP = runRoot;
  process.env.TMPDIR = runRoot;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export async function teardown(): Promise<void> {
  if (!runRoot) return;
  const root = runRoot;
  runRoot = undefined;

  /**
   * Chromium writes its own `playwright_chromiumdev_profile-*` scratch dir **inside** this
   * root (it honours TEMP) and does not necessarily release it before the suite's teardown
   * runs. Measured on Windows: a single file that opens a browser leaked the whole run root
   * **3/3 times** with Node's built-in retries alone (`maxRetries: 10, retryDelay: 100` ≈ 1s),
   * because the lock outlives that budget; a full suite often got lucky and hid this, which
   * is why C94 originally reported "0 leaked" — that reading was true but the mechanism was
   * still there. So retry for a few seconds here instead.
   *
   * Cleanup stays best-effort: a failure must not redden the suite (orphan *browsers* are a
   * different concern, covered by `check:stray-browsers`).
   */
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch {
      if (Date.now() >= deadline) return;
      await sleep(250);
    }
  }
}
