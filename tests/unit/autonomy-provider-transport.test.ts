// @vitest-environment node
import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Model } from '../../openclaw_runtime/src/llm/types';
import { buildGuardedModelFetch } from '../../openclaw_runtime/src/agents/provider-transport-fetch';
import { attachModelProviderRequestTransport } from '../../openclaw_runtime/src/agents/provider-request-config';
import { closeProviderOutboundBudget, configureProviderOutboundBudget, providerOutboundBudgetStats, resetProviderOutboundBudget } from '../../openclaw_runtime/src/agents/provider-outbound-budget';

describe('TF-0679 actual provider transport ownership', () => {
  it('releases the owner slot before an EOF response is returned to its consumer', async () => {
    resetProviderOutboundBudget();
    const server = createServer((request, response) => { request.resume(); response.end('complete'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const model = attachModelProviderRequestTransport({ id: 'fixture', name: 'EOF resource proof', provider: 'r1-eof-fixture', api: 'openai-completions',
      baseUrl, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 512 } satisfies Model,
      { allowPrivateNetwork: true });
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0 } });
    const guarded = buildGuardedModelFetch(model, 30000, { sanitizeSse: false });
    try {
      const first = await guarded(baseUrl); expect(await first.text()).toBe('complete');
      expect(providerOutboundBudgetStats()[0].active).toBe(0);
      const second = await guarded(baseUrl); expect(await second.text()).toBe('complete');
      expect(providerOutboundBudgetStats()[0].completed).toBe(2);
    } finally { closeProviderOutboundBudget(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); resetProviderOutboundBudget(); }
  });

  it('retains the quota across reconfiguration and sends no queued or aborted HTTP request', async () => {
    resetProviderOutboundBudget();
    let arrivals = 0, active = 0, peak = 0;
    const serverResponses: ServerResponse[] = [];
    const events: Array<{ event: string; request: number; active: number }> = [];
    const server = createServer((request, response) => {
      request.resume();
      const id = ++arrivals;
      active += 1;
      peak = Math.max(peak, active);
      events.push({ event: 'arrived', request: id, active });
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        active -= 1;
        events.push({ event: 'finished', request: id, active });
      };
      response.once('finish', finish);
      response.once('close', finish);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: {"fixture":true}\n\n');
      serverResponses.push(response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture port');
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const model = attachModelProviderRequestTransport({
      id: 'fixture', name: 'local resource proof', provider: 'r1-local-fixture', api: 'openai-completions',
      baseUrl, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096, maxTokens: 512,
    } satisfies Model, { allowPrivateNetwork: true });
    const guarded = buildGuardedModelFetch(model, 5000, { sanitizeSse: false });
    const responses: Response[] = [];
    const pending: Promise<Response>[] = [];
    const send = (signal?: AbortSignal) => {
      const promise = guarded(baseUrl + '/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'fixture', messages: [], stream: true }), signal,
      }).then(response => { responses.push(response); return response; });
      pending.push(promise);
      return promise;
    };
    const counts = () => providerOutboundBudgetStats().map(({ active, queued, maxConcurrent, admitted, completed }) => ({ active, queued, maxConcurrent, admitted, completed }));
    try {
      const config = { limits: { maxConcurrent: 1, maxQueue: 2, queueTimeoutMs: 5000 } };
      configureProviderOutboundBudget(config);
      const first = await send();
      expect(arrivals).toBe(1);
      configureProviderOutboundBudget(config);
      expect(counts()[0]).toMatchObject({ active: 1, maxConcurrent: 1 });
      const abort = new AbortController();
      const cancelled = send(abort.signal);
      await expect.poll(() => counts()[0]?.queued, { timeout: 2000 }).toBe(1);
      expect(arrivals).toBe(1);
      abort.abort();
      await expect(cancelled).rejects.toMatchObject({ reason: 'aborted' });
      expect(arrivals).toBe(1);
      const next = send();
      await expect.poll(() => counts()[0]?.queued, { timeout: 2000 }).toBe(1);
      serverResponses[0].end('data: [DONE]\n\n');
      await first.text();
      const second = await next;
      expect(arrivals).toBe(2);
      serverResponses[1].end('data: [DONE]\n\n');
      await second.text();
      await expect.poll(() => counts()[0]?.active, { timeout: 2000 }).toBe(0);
      expect(peak).toBe(1);
      const evidenceDir = path.join(process.cwd(), 'artifacts/runs/autonomy-resource-admission');
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(path.join(evidenceDir, 'provider-http-' + randomUUID() + '.json'), JSON.stringify({
        driven_by: 'agent', actor: 'codex-r1-local-http', arrivals, peakActiveResponses: peak, events,
        owner: counts(), cancelledRequestWasNotSent: true,
        limits: ['actual local HTTP through production guarded provider fetch', 'no live-provider quality or cost measurement', 'quota identifiers and account discriminators are intentionally omitted'],
      }, null, 2) + '\n');
    } finally {
      for (const response of responses) await response.body?.cancel().catch(() => undefined);
      closeProviderOutboundBudget();
      server.closeAllConnections();
      await Promise.allSettled(pending);
      await new Promise<void>(resolve => server.close(() => resolve()));
      resetProviderOutboundBudget();
    }
  }, 30_000);
});
