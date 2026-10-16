/**
 * TF-0188 / mig-24 — a host cancel must be terminal for the owned session.
 *
 * When the operator presses Stop, the host emits `notifications/cancelled` for the in-flight tool
 * call. Two product clauses are pinned here end to end against the real stdio server:
 *   1. the in-flight call is terminated — the owned session is gone afterwards, not merely hidden;
 *   2. cancelling produces no follow-up traffic (no automatic replay/retry).
 * MCP also forbids replying to a cancelled request, so "the call does not settle successfully" is
 * asserted rather than an `E_CANCELLED` payload: that reply is dropped by the protocol layer.
 */
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

it('treats a host cancel as terminal for the owned session and does not replay traffic', async () => {
  let pageLoads = 0;
  const http = createServer((req, res) => {
    if (req.url === '/') pageLoads++;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>cancel fixture</title><h1>cancel fixture</h1><button>go</button>');
  });
  await new Promise<void>(done => http.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const root = await mkdtemp(join(tmpdir(), 'vb-mcp-cancel-'));
  const client = new Client({ name: 'mcp-cancel-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-strip-types', resolve('src/mcp/server.ts')],
    cwd: root,
    env: {
      ...process.env,
      VERSEBROWSER_BACKEND: 'upstream',
      VERSEBROWSER_TOOL_GROUPS: 'core',
      VERSEBROWSER_CAPS: 'browser.open,browser.navigate,browser.act,browser.observe,browser.close',
      VERSEBROWSER_ALLOWED_ORIGINS: JSON.stringify([origin]),
      VERSEBROWSER_WORKSPACE: root,
    } as Record<string, string>,
    stderr: 'pipe',
  });
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    return JSON.parse((response.content as { text: string }[])[0].text) as {
      ok: boolean; content?: string; data?: { session?: { id?: string } };
    };
  };
  try {
    await client.connect(transport);
    const opened = await call('vb_open', { url: `${origin}/` });
    expect(opened.ok, opened.content).toBe(true);
    const sessionId = opened.data!.session!.id!;
    expect(pageLoads).toBe(1);

    const controller = new AbortController();
    let state = 'pending';
    const pending = client
      .callTool({ name: 'vb_wait', arguments: { sessionId, selector: '#never-appears', timeoutMs: 60_000 } }, undefined, { signal: controller.signal })
      .then(() => { state = 'resolved'; }, () => { state = 'rejected'; });
    await sleep(1500);
    expect(state, 'the call must be genuinely in flight before it is cancelled').toBe('pending');

    controller.abort();
    await pending;
    expect(state, 'a cancelled request must not settle successfully').toBe('rejected');

    // Terminal for the session: a later read on the same id must report it gone. `vb_snapshot` is
    // used instead of a navigation so the existence probe itself cannot add page loads.
    await expect
      .poll(async () => (await call('vb_snapshot', { sessionId })).ok, { timeout: 15_000 })
      .toBe(false);
    const after = await call('vb_snapshot', { sessionId });
    expect(String(after.content ?? '')).toMatch(/unknown session/i);

    await sleep(2000);
    expect(pageLoads, 'cancelling must not trigger a replay of the traffic').toBe(1);
  } finally {
    await client.close().catch(() => undefined);
    http.closeAllConnections?.();
    await new Promise<void>(done => http.close(() => done()));
  }
}, 45_000);