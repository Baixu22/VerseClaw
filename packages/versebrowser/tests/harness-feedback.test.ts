import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';
import { createMcpServer } from '../src/mcp/server.ts';
import { resolveMcpPolicy } from '../src/mcp/capability-policy.ts';
import { renderToolResultForTool } from '../src/mcp/result-envelope.ts';
import { createEvidenceRef, okResult } from '../src/contracts/index.ts';

describe('harness verification feedback', () => {
  for (const recording of [false, true]) {
    for (const outcome of ['pass', 'fail', 'unknown'] as const) {
      it(`${outcome} survives MCP rendering (recording=${recording})`, async () => {
        const root = await mkdtemp(join(tmpdir(), 'vb-feedback-'));
        const api = {
          evaluate: async () => ({ success: true, value: { found: true, text: 'Received!', disabled: false } }),
          getConsoleMessages: async () => ({ success: true, content: '' }),
          networkListRequests: async () => ({ success: outcome !== 'unknown', requests: [], error: 'capture unavailable' }),
          close: async () => ({ success: true }),
        } as unknown as AgentBrowserHostApi;
        const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
        const server = createMcpServer({ facade, policy: resolveMcpPolicy({ groups: 'evidence', caps: 'evidence.write,evidence.read', env: {} }) });
        const client = new Client({ name: 'harness-feedback-test', version: '1' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        try {
          if (recording) await facade.recordStart('test', { dirName: 'record' });
          const response = await client.callTool({ name: 'vb_verify_flow', arguments: {
            sessionId: 'test', screenshot: false,
            expect: [{ type: 'text', selector: '#message', equals: outcome === 'fail' ? 'Wrong!' : 'Received!', label: 'receipt' }],
          } });
          const result = JSON.parse((response.content as Array<{ text: string }>)[0]!.text);
          // Tool execution success is distinct from the business outcome.
          expect(result.ok).toBe(true);
          expect(result.data).toMatchObject({ outcome, ok: outcome === 'pass', collection: { overall: outcome === 'unknown' ? 'failed' : 'ok' } });
          const dir = dirname(result.evidence.find((e: { kind: string }) => e.kind === 'verify').path);
          const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
          expect(report.outcome).toBe(outcome);
          if (outcome === 'unknown') {
            expect(await readFile(join(dir, 'diagnosis.md'), 'utf8')).not.toContain('no remediation required');
          }
          if (outcome === 'fail') {
            expect(result.data.failedCheckCount).toBe(1);
            expect(result.data.failedChecks[0]).toMatchObject({ label: 'receipt' });
            expect(await readFile(join(dir, 'diagnosis.md'), 'utf8')).toContain('receipt');
            expect(await readFile(join(dir, 'diagnosis.md'), 'utf8')).not.toContain('no remediation required');
            expect(await readFile(join(dir, 'pr-comment.md'), 'utf8')).not.toContain('No failure points');
            // Offline re-diagnosis must not erase the failed assertion.
            const replay = await facade.diagnose({ dir });
            expect(replay.content).toContain('receipt');
            expect(replay.content).toContain('FAIL');
          }
        } finally {
          await facade.close('test');
          await client.close();
          await server.close();
        }
      });
    }
  }

  it('keeps bounded decision fields when summary and failures exceed the budget', () => {
    const result = okResult('verbose '.repeat(5000), {
      schemaVersion: 1, ok: false, outcome: 'fail',
      collection: { console: 'ok', network: 'ok', overall: 'ok', notes: [] },
      selectors: [], expectations: Array.from({ length: 100 }, (_, i) => ({ type: 'text', label: `check ${i}`, passed: false, detail: 'token=supersecret123456 ' + 'x'.repeat(2000) })),
      consoleDiff: { newErrors: [] }, networkFailures: { count: 0 },
    }, [createEvidenceRef({ kind: 'verify', label: 'summary', path: '.ae/evidence/verify/example/summary.md' })]);
    const text = renderToolResultForTool('vb_verify_flow', result, { maxChars: 1000, hardMaxChars: 4000 });
    const parsed = JSON.parse(text);
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(parsed.data.outcome).toBe('fail');
    expect(parsed.data.failedCheckCount).toBe(100);
    expect(parsed.data.failedChecksTruncated).toBe(true);
    expect(parsed.data.failedChecks.length).toBeGreaterThan(0);
    expect(parsed.evidence[0].path).toContain('summary.md');
    expect(text).not.toContain('supersecret123456');
  });

  /**
   * An unparseable `expect` item used to be dropped, so `{type:'text',equals:'Save'}` (no selector)
   * ran zero business checks and reported `outcome: pass` — a success claim about a page the caller
   * never asserted on. Malformed input must be refused, not silently turned into a PASS.
   */
  it('refuses an expect item that has no selector instead of dropping it into a PASS', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-feedback-drop-'));
    const api = {
      evaluate: async () => ({ success: true, value: { found: true, text: 'Received!', disabled: false } }),
      getConsoleMessages: async () => ({ success: true, content: '' }),
      networkListRequests: async () => ({ success: true, requests: [] }),
      close: async () => ({ success: true }),
    } as unknown as AgentBrowserHostApi;
    const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
    const server = createMcpServer({ facade, policy: resolveMcpPolicy({ groups: 'evidence', caps: 'evidence.write,evidence.read', env: {} }) });
    const client = new Client({ name: 'harness-feedback-drop-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const response = await client.callTool({ name: 'vb_verify_flow', arguments: {
        sessionId: 'test', screenshot: false, expect: [{ type: 'text', equals: 'Received!' }],
      } });
      const result = JSON.parse((response.content as Array<{ text: string }>)[0]!.text);
      expect(result.ok, JSON.stringify(result)).toBe(false);
      expect(result.error?.code).toBe('E_ARG');
      expect(result.error?.message).toContain('expect[0]');
      expect(result.data?.outcome).toBeUndefined();
    } finally {
      await facade.close('test');
      await client.close();
      await server.close();
    }
  });
});
