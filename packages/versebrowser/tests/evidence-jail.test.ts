/**
 * TF-0115：证据写入的**边界约束**。
 *
 * 背景（安全）：`vb_screenshot` 的 `fileName` 是调用方（以及可被页面间接影响的一方）提供的，
 * 而它**没有**经过 sanitize —— `path.join` 会解析 `..`，于是写入直接逃出 evidence root。
 * 实测：`../../../../pwn-4.png` 落到**仓库根**，21 级上跳落到**盘根** `D:\`，且工具仍返回 `ok: true`。
 *
 * 同时钉住：`vb_explain_error` 曾返回一个**没有 path** 的 evidence 引用（声称有证据却指向空）。
 *
 * 无 Chromium 时 live 用例 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';

const PAGE = `data:text/html,${encodeURIComponent('<!doctype html><html><head><title>T</title></head><body><h1>hi</h1></body></html>')}`;

async function setup(): Promise<{ facade: AgentBrowserFacade; sessionId: string; root: string } | null> {
  let api;
  try {
    api = await createPlaywrightHostApi();
  } catch {
    return null;
  }
  const root = await mkdtemp(join(tmpdir(), 'vb-jail-'));
  const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
  const opened = await facade.open({ url: PAGE, mode: 'headless' });
  const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
  if (!sessionId) return null;
  return { facade, sessionId, root };
}

describe('evidence write stays inside the evidence root (TF-0115)', () => {
  it('穿越型 fileName 被 sanitize，写入仍在 evidence root 内', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId, root } = ctx;
    const evidenceRoot = join(root, 'evidence-root');
    const scoped = new AgentBrowserFacade({
      api: (facade as unknown as { api: never }).api,
      evidenceRoot,
    });
    const opened = await scoped.open({ url: PAGE, mode: 'headless' });
    const sid = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;

    try {
      const escapes = [
        'pwn-0.png',
        '../pwn-1.png',
        '../../pwn-2.png',
        '../../../pwn-3.png',
        '../../../../pwn-4.png',
        '../../../../../../../../pwn-8.png',
        '..\\..\\..\\pwn-win.png',
        'C:\\Windows\\Temp\\pwn-abs.png',
      ];
      const resolvedRoot = resolve(evidenceRoot);
      for (const fileName of escapes) {
        const shot = await scoped.screenshotToDisk(sid, { fileName });
        expect(
          shot.ok,
          `screenshot with fileName=${fileName} should still succeed: ${JSON.stringify(shot.error)}`,
        ).toBe(true);
        const reported = (shot.data as { path?: string } | undefined)?.path ?? '';
        /*
         * 判据是解析后仍在 root 内。C100 统一使用 workspace 的命名规则，
         * `../pwn-1.png` 变成 `___pwn-1.png`；路径安全仍由包含性检查证明。
         */
        const absolute = resolve(reported);
        expect(
          absolute === resolvedRoot || absolute.startsWith(`${resolvedRoot}${sep}`),
          `fileName=${fileName} wrote outside the evidence root: ${absolute}`,
        ).toBe(true);
      }

      // 越界路径**不应**存在于 root 之外（探测名 pwn-4 曾落到仓库根）
      expect(existsSync(join(root, 'pwn-4.png'))).toBe(false);
      expect(existsSync(join(resolve(root, '..'), 'pwn-4.png'))).toBe(false);
    } finally {
      await scoped.close(sid).catch(() => undefined);
      await facade.close(sessionId).catch(() => undefined);
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  }, 60_000);

  it('vb_explain_error 的 evidence 引用要么带 path，要么不返回引用', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId, root } = ctx;
    try {
      const explained = await facade.explain('TypeError: boom\n    at fn (https://example.com/a.js:1:100)');
      expect(explained.ok).toBe(true);
      const refs = (explained.evidence ?? []) as Array<{ kind?: string; path?: string }>;
      // 声称有证据就必须给得出去处：不能出现"有引用但没有文件"的悬空指针
      for (const ref of refs) {
        expect(
          typeof ref.path === 'string' && ref.path.length > 0,
          `evidence ref ${JSON.stringify(ref)} has no path — it points at nothing`,
        ).toBe(true);
      }
    } finally {
      await facade.close(sessionId).catch(() => undefined);
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  }, 60_000);

  /**
   * TF-0119：`vb_diagnose` 的 `dir` 是**读写双向**的 sink。
   *
   * 实测（修复前）：在系统临时目录放一个 `timeline.json`，`vb_diagnose { dir }` 会
   * 读它并把内容**回显进模型上下文**，同时往那个目录写 diagnosis.json / diagnosis.md /
   * viewer.html。这是继 screenshot `fileName`(#14) 与 pr-comment `packDir`(#18) 之后
   * **第三处**同类遗漏 —— 所以修法不是再抄一遍检查，而是把不变式集中到
   * `src/evidence/path-guard.ts`，让新 sink 不会悄悄缺检查。
   */
  it('vb_diagnose 拒绝证据根之外的 dir，且不读取也不写入其内容', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId, root } = ctx;
    // setup 的 evidenceRoot 就是 root，所以 root 的兄弟目录在证据根之外
    const outside = await mkdtemp(join(tmpdir(), 'vb-outside-diag-'));
    writeFileSync(
      join(outside, 'timeline.json'),
      JSON.stringify({
        schemaVersion: 1,
        startedAt: new Date().toISOString(),
        sessionId: 'LEAKED',
        events: [
          { seq: 1, at: new Date().toISOString(), kind: 'action', name: 'LEAKED-EVENT-NAME', ok: false, detail: {} },
        ],
      }),
      'utf8',
    );

    try {
      const before = readdirSync(outside).sort();
      const result = await facade.diagnose({ dir: outside });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('E_DIAGNOSE');
      // 关键：外部内容绝不进入返回
      expect(JSON.stringify(result)).not.toContain('LEAKED-EVENT-NAME');
      // 关键：也不得往外部目录写任何东西
      expect(readdirSync(outside).sort()).toEqual(before);
    } finally {
      await facade.close(sessionId).catch(() => undefined);
      await rm(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  }, 60_000);

  it('证据根内的 diagnose dir 仍可用（正常路径不被误伤）', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId, root } = ctx;
    try {
      const started = await facade.recordStart(sessionId, { dirName: 'tf0119' });
      expect(started.ok).toBe(true);
      const stopped = await facade.recordStop(sessionId);
      expect(stopped.ok).toBe(true);

      // setup 的 evidenceRoot = root，录制目录在 <root>/record/<dirName>
      const dir = join(root, 'record', 'tf0119');
      const diagnosis = await facade.diagnose({ dir });
      expect(
        diagnosis.ok,
        `in-root diagnose should work: ${String(diagnosis.content).slice(0, 160)}`,
      ).toBe(true);
    } finally {
      await facade.close(sessionId).catch(() => undefined);
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  }, 60_000);
});

/**
 * `src/evidence/path-guard.ts` 是所有证据 sink 共用的不变式。
 * 直接单测它，避免"每个 sink 各自抄一份、某一份漏了"再次发生。
 */
describe('shared evidence path guard (TF-0119)', () => {
  it('isInsideRoot 只认 root 自身与其后代', async () => {
    const { isInsideRoot } = await import('../src/evidence/path-guard.ts');
    const root = join(tmpdir(), 'vb-guard-root');
    expect(isInsideRoot(root, join(root, 'a'))).toBe(true);
    expect(isInsideRoot(root, join(root, 'a', 'b.md'))).toBe(true);
    expect(isInsideRoot(root, root)).toBe(true);
    expect(isInsideRoot(root, join(root, '..', 'sibling'))).toBe(false);
    expect(isInsideRoot(root, join(root, '..', '..', 'escape'))).toBe(false);
    // 前缀相同但不是后代（vb-guard-root-evil）
    expect(isInsideRoot(root, `${root}-evil`)).toBe(false);
  });

  it('assertInsideRoot 抛错并给出稳定码', async () => {
    const { assertInsideRoot, EvidencePathError } = await import('../src/evidence/path-guard.ts');
    const root = join(tmpdir(), 'vb-guard-root2');
    expect(() => assertInsideRoot(root, join(root, 'ok'))).not.toThrow();
    try {
      assertInsideRoot(root, join(root, '..', '..', 'escape'));
      throw new Error('expected assertInsideRoot to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EvidencePathError);
      expect((error as { code?: string }).code).toBe('E_EVIDENCE_PATH');
    }
  });

  it('sanitizeSegment 剥掉分隔符（../x 变字面量，不再穿越）', async () => {
    const { sanitizeSegment } = await import('../src/evidence/path-guard.ts');
    expect(sanitizeSegment('../pwn')).toBe('___pwn');
    expect(sanitizeSegment('a/b')).toBe('a_b');
    expect(sanitizeSegment('a\\b')).toBe('a_b');
    expect(sanitizeSegment('C:\\Windows')).not.toContain(':');
    expect(sanitizeSegment('')).toBe('session');
    expect(sanitizeSegment('x'.repeat(300)).length).toBe(64);
  });
});
