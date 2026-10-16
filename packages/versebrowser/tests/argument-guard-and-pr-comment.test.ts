/**
 * TF-0116 / TF-0117：两处由深挖探针发现的缺口。
 *
 * TF-0116 —— `vb_pr_comment` 的 `packDir` 未做边界约束：能读**工作区之外**目录里的
 *   `manifest.json` 并把内容回显进模型上下文（实测把外部 label 渲染了出来），
 *   而且还会往该目录**写** `pr-comment.md`。既是读取越界，也是写入越界。
 *
 * TF-0117 —— 每个工具的 `inputSchema` 都声明 `additionalProperties: false`，
 *   但没有任何地方校验入参：未知/拼错的参数被**静默忽略**。最危险的是拼错**可选**参数
 *   （如 `includeTxt`）会成功返回、行为却不同，调用方毫无察觉；拼错必填参数则报出
 *   与参数名无关的驱动错误。
 *
 * 无 Chromium 时 live 用例 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { TOOL_CATALOG } from '../src/mcp/server.ts';

const PAGE = `data:text/html,${encodeURIComponent('<!doctype html><html><body><h1>hi</h1></body></html>')}`;

async function setup(): Promise<{ facade: AgentBrowserFacade; sessionId: string; root: string } | null> {
  let api;
  try {
    api = await createPlaywrightHostApi();
  } catch {
    return null;
  }
  const root = await mkdtemp(join(tmpdir(), 'vb-deep-'));
  const facade = new AgentBrowserFacade({ api, evidenceRoot: join(root, 'evidence') });
  const opened = await facade.open({ url: PAGE, mode: 'headless' });
  const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
  if (!sessionId) return null;
  return { facade, sessionId, root };
}

describe('pr_comment stays inside the evidence root (TF-0116)', () => {
  it('拒绝工作区外的 packDir，且不回显其 manifest 内容', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId, root } = ctx;
    const outside = join(root, 'outside-pack');
    mkdirSync(outside, { recursive: true });
    writeFileSync(
      join(outside, 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, packId: 'p', label: 'LEAKED-LABEL', files: [] }),
      'utf8',
    );

    try {
      const result = await facade.exportPrComment(outside);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('E_PR_COMMENT');
      // 关键：外部内容绝不能进入返回
      expect(String(result.content)).not.toContain('LEAKED-LABEL');
      // 错误信息也不应泄露绝对路径
      expect(String(result.content)).not.toMatch(/[A-Za-z]:\\/u);
    } finally {
      await facade.close(sessionId).catch(() => undefined);
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  }, 60_000);

  it('允许证据根**内**的 pack（正常路径不被误伤）', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId, root } = ctx;
    try {
      // 走真实的证据写入器，在**证据根内**造一个 pack
      const { writeEvidencePack } = await import('../src/evidence/writer.ts');
      const pack = await writeEvidencePack({
        rootDir: join(root, 'evidence'),
        label: 'in-root-pack',
        summaryMarkdown: '# in-root-pack\n',
      });
      expect(pack.packDir).toBeTruthy();

      const comment = await facade.exportPrComment(pack.packDir);
      expect(comment.ok, `in-root pack should still export: ${String(comment.content).slice(0, 120)}`).toBe(true);
      expect(String(comment.content)).toContain('in-root-pack');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  }, 60_000);
});

describe('inputSchema additionalProperties is enforced (TF-0117)', () => {
  it('每个工具的 inputSchema 都声明 additionalProperties:false（前提成立）', () => {
    for (const tool of TOOL_CATALOG) {
      expect(
        (tool.inputSchema as { additionalProperties?: boolean }).additionalProperties,
        `${tool.name} should declare additionalProperties:false`,
      ).toBe(false);
    }
  });

  it('未知参数名被拒绝，并指名是哪一个（E_ARG_UNKNOWN）', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId, root } = ctx;
    try {
      /*
       * 这些参数名是**故意拼错**的：旧行为下它们会被静默忽略。
       * facade 层不做 schema 校验（校验在 MCP dispatcher），所以这里直接断言
       * 校验函数本身的行为，避免为测试起一个 MCP 进程。
       */
      const { validateArguments } = await import('../src/mcp/argument-guard.ts');
      const { TOOL_CATALOG: CATALOG } = await import('../src/mcp/server.ts');
      expect(validateArguments(CATALOG, 'vb_snapshot', { sessionId, includeTxt: true })).toEqual(['includeTxt']);
      expect(validateArguments(CATALOG, 'vb_click', { sessionId, selectors: '#b' })).toEqual(['selectors']);
      expect(validateArguments(CATALOG, 'vb_type', { sessionId, selector: '#b', txt: 'x' })).toEqual(['txt']);
      expect(validateArguments(CATALOG, 'vb_nav', { sessionId, ur1: 'https://x/' })).toEqual(['ur1']);
      expect(validateArguments(CATALOG, 'vb_click', { sessionId, selector: '#b', bogus: 1 })).toEqual(['bogus']);
      // 合法参数不得被误报
      expect(validateArguments(CATALOG, 'vb_click', { sessionId, selector: '#b', timeoutMs: 100 })).toEqual([]);
      expect(
        validateArguments(CATALOG, 'vb_snapshot', { sessionId, includeText: true, textChars: 100, diff: true }),
      ).toEqual([]);
    } finally {
      await facade.close(sessionId).catch(() => undefined);
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  }, 60_000);

  it('validateArguments 对未知工具返回空（交由能力门处理）', async () => {
    const { validateArguments } = await import('../src/mcp/argument-guard.ts');
    const { TOOL_CATALOG: CATALOG } = await import('../src/mcp/server.ts');
    expect(validateArguments(CATALOG, 'vb_not_a_tool', { anything: 1 })).toEqual([]);
  });

  /**
   * 端到端：**真的经 MCP dispatcher** 调用，确认校验确实接在调用链上。
   * 只测 helper 会漏掉"接线断了"这类回归。
   */
  it('经 MCP dispatcher 调用时，拼错参数返回 E_ARG_UNKNOWN', async () => {
    const { createMcpServer } = await import('../src/mcp/server.ts');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { resolveMcpPolicy } = await import('../src/mcp/capability-policy.ts');

    const policy = resolveMcpPolicy({
      groups: 'core',
      caps: 'browser.open,browser.observe,browser.act,browser.close',
    });
    const server = createMcpServer({ policy });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'vb-arg-test', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const bad = (await client.callTool({
        name: 'vb_snapshot',
        arguments: { sessionId: 's-1', includeTxt: true },
      })) as { content?: Array<{ text?: string }>; isError?: boolean };
      const text = bad.content?.map((c) => c.text ?? '').join('\n') ?? '';
      expect(bad.isError).toBe(true);
      expect(text).toContain('E_ARG_UNKNOWN');
      // 必须指名是哪个参数，否则调用方无从修正
      expect(text).toContain('includeTxt');
    } finally {
      await client.close().catch(() => undefined);
    }
  }, 30_000);
});
