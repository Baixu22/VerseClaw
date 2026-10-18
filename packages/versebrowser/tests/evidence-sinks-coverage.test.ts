/**
 * TF-0119（补全）：证据 sink 的边界断言**逐一覆盖**。
 *
 * 背景：同类越界被陆续发现三处（screenshot `fileName` #14、pr-comment `packDir` #18、
 * diagnose `dir` #19），其中 `diagnose.dir` 是**未 sanitize** 的整条路径，守卫在行为上
 * 必需（负例见 tests/evidence-jail.test.ts，回退后转红）。
 *
 * 诚实边界 —— 读这个文件时请注意：
 *   `record_start.dirName` 与 `verify_flow.evidenceDirName` 都**经过 `sanitize()`**，
 *   而 sanitize 已能剥掉分隔符。实测：把这两处的 `assertInsideRoot` 去掉，本文件
 *   **仍然全绿**。所以本文件的用例证明的是**可观察行为**（产物只落在根内），
 *   **不能**证明守卫被接线；那两处的守卫属**纵深防御**，不是行为必需。
 *   真正行为必需的是 `diagnose.dir` / `screenshot.fileName` / `pr_comment.packDir`
 *   （三者都有能转红的负例）。
 *
 * 无 Chromium 时 live 用例 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';

const PAGE = `data:text/html,${encodeURIComponent('<!doctype html><html><head><title>T</title></head><body><h1>hi</h1></body></html>')}`;

type Ctx = { facade: AgentBrowserFacade; sessionId: string; evidenceRoot: string };
async function setup(): Promise<Ctx | null> {
  let api;
  try {
    api = await createPlaywrightHostApi();
  } catch {
    return null;
  }
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'vb-sinks-evidence-'));
  const facade = new AgentBrowserFacade({ api, evidenceRoot });
  const opened = await facade.open({ url: PAGE, mode: 'headless' });
  const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
  if (!sessionId) return null;
  return { facade, sessionId, evidenceRoot };
}

async function cleanup(ctx: Ctx | null): Promise<void> {
  if (!ctx) return;
  await ctx.facade.close(ctx.sessionId).catch(() => undefined);
  await rm(ctx.evidenceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
    () => undefined,
  );
}

describe('every evidence sink refuses an out-of-root target (TF-0119)', () => {
  it('record_start 的 dirName 产物只落在根内（sanitize 已足以防穿越）', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    try {
      // sanitize 会把 ./.. 变成字面量，所以**正常调用**仍必须在根内成功
      const started = await ctx.facade.recordStart(ctx.sessionId, { dirName: '../../../escape' });
      expect(started.ok).toBe(true);
      const dir = (started.data as { dir?: string }).dir as string;
      expect(dir.startsWith(ctx.evidenceRoot)).toBe(true);
      // 且根外没有出现 escape 目录
      expect(existsSync(join(ctx.evidenceRoot, '..', '..', '..', 'escape'))).toBe(false);
      await ctx.facade.recordStop(ctx.sessionId).catch(() => undefined);
    } finally {
      await cleanup(ctx);
    }
  }, 60_000);

  it('verify_flow 的 dirName 产物只落在根内（sanitize 已足以防穿越）', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    try {
      const verify = await ctx.facade.verifyFlow({
        sessionId: ctx.sessionId,
        selectors: ['h1'],
        screenshot: false,
        evidenceDirName: '../../../escape-verify',
      });
      expect(verify.ok).toBe(true);
      const paths = (verify.evidence ?? [])
        .map((ref) => (ref as { path?: string }).path)
        .filter((p): p is string => typeof p === 'string');
      expect(paths.length).toBeGreaterThan(0);
      // 所有证据引用都必须落在证据根内
      for (const p of paths) {
        const absolute = p.startsWith(ctx.evidenceRoot) ? p : join(ctx.evidenceRoot, p);
        expect(
          absolute.startsWith(ctx.evidenceRoot),
          `evidence path escaped the root: ${p}`,
        ).toBe(true);
      }
      // 根外不得出现产物目录
      expect(existsSync(join(ctx.evidenceRoot, '..', '..', '..', 'escape-verify'))).toBe(false);
    } finally {
      await cleanup(ctx);
    }
  }, 60_000);

  it('sink 清点：所有接受路径类入参的工具都已在上面覆盖', async () => {
    /*
     * 这是防"新增 sink 忘了写测试"的清单守卫。若将来新增一个路径类入参，
     * 本用例会失败并提示补测 —— 与 path-guard 的集中化配套。
     */
    const { TOOL_CATALOG } = await import('../src/mcp/server.ts');
    const PATHY = ['dir', 'packDir', 'dirName', 'fileName'];
    const found: Array<{ tool: string; param: string }> = [];
    for (const tool of TOOL_CATALOG) {
      const props = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      for (const param of props.filter((p) => PATHY.includes(p))) {
        found.push({ tool: tool.name, param });
      }
    }
    // 期望集合：与实现里接守卫的 sink 一一对应
    expect(found.map((f) => `${f.tool}.${f.param}`).sort()).toEqual(
      [
        'vb_diagnose.dir',
        'vb_evidence_write.dirName',
        'vb_pr_comment.packDir',
        'vb_record_start.dirName',
        'vb_screenshot.fileName',
      ].sort(),
    );
    /*
     * 注：`vb_evidence_write.dirName` 经核实**只作为 label**（packId 是随机的），
     * 不构成路径 sink，因此它不需要守卫 —— 见下面的显式断言。
     */
    const { writeEvidencePack } = await import('../src/evidence/writer.ts');
    const root = await mkdtemp(join(tmpdir(), 'vb-sinks-label-'));
    try {
      const pack = await writeEvidencePack({
        rootDir: root,
        label: '../../../escape-label',
        packId: undefined,
        summaryMarkdown: '# x\n',
      });
      // packId 与 label 无关，且目录必在 root 内
      expect(pack.packDir.startsWith(root)).toBe(true);
      expect(readdirSync(root).some((entry) => entry.includes('escape-label'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
        () => undefined,
      );
    }
  }, 30_000);

  it('根内的正常路径不被守卫误伤（全 sink 冒烟）', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    try {
      const shot = await ctx.facade.screenshotToDisk(ctx.sessionId, { fileName: 'smoke.png' });
      // 断言里带上底层错误：本用例曾在全量并发下间歇失败，只报 false 无从定位。
      expect(shot.ok, `in-root screenshot failed: ${JSON.stringify(shot.error)}`).toBe(true);

      const rec = await ctx.facade.recordStart(ctx.sessionId, { dirName: 'smoke-rec' });
      expect(rec.ok).toBe(true);
      const stopped = await ctx.facade.recordStop(ctx.sessionId);
      expect(stopped.ok).toBe(true);

      const diag = await ctx.facade.diagnose({ dir: join(ctx.evidenceRoot, 'record', 'smoke-rec') });
      expect(diag.ok, `in-root diagnose: ${String(diag.content).slice(0, 120)}`).toBe(true);

      const verify = await ctx.facade.verifyFlow({
        sessionId: ctx.sessionId,
        selectors: ['h1'],
        screenshot: false,
      });
      expect(verify.ok).toBe(true);

      const { writeEvidencePack } = await import('../src/evidence/writer.ts');
      const pack = await writeEvidencePack({
        rootDir: ctx.evidenceRoot,
        label: 'smoke-pack',
        summaryMarkdown: '# smoke\n',
      });
      const comment = await ctx.facade.exportPrComment(pack.packDir);
      expect(comment.ok, `in-root pr-comment: ${String(comment.content).slice(0, 120)}`).toBe(true);
    } finally {
      await cleanup(ctx);
    }
  }, 90_000);
});
