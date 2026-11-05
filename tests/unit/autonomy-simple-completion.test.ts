// @vitest-environment node
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { prepareModelForSimpleCompletion } from '../../openclaw_runtime/src/agents/simple-completion-transport';
import { completeSimple } from '../../openclaw_runtime/src/llm/stream';
import { getApiProvider, unregisterApiProviders } from '../../openclaw_runtime/src/llm/api-registry';
import { getCustomApiRegistrySourceId } from '../../openclaw_runtime/src/agents/custom-api-registry';
import type { Model } from '../../openclaw_runtime/src/llm/types';

describe('TF-0672 source-runtime self-check transport', () => {
  it('uses the existing HTTP owner when pruned SDK registration is absent, without changing a registered public provider', async () => {
    const seen: Array<{ method?: string; path?: string; payload: unknown }> = [];
    const server = createServer((req, res) => {
      let raw = ''; req.on('data', bytes => { raw += bytes; });
      req.on('end', () => {
        seen.push({ method: req.method, path: req.url, payload: JSON.parse(raw) });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (delta: unknown, finish: string | null) => 'data: ' + JSON.stringify({ id: 'scenario-review', object: 'chat.completion.chunk', created: 1, model: 'mock-coder',
          choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n';
        res.write(chunk({ role: 'assistant', content: '{"decision":"complete","scenario_only":true}' }, null));
        res.write(chunk({}, 'stop')); res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No local scenario endpoint');
    const alias = 'openclaw-openai-completions-transport';
    const previousAlias = getApiProvider(alias), previousPublic = getApiProvider('openai-completions');
    try {
      const model = { id: 'mock-coder', name: 'mock-coder', provider: 'openai', api: 'openai-completions', baseUrl: 'http://127.0.0.1:' + address.port + '/v1',
        reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1000 } as Model;
      const prepared = prepareModelForSimpleCompletion({ model });
      expect(prepared.api).toBe(previousPublic ? model.api : alias);
      const result = await completeSimple(prepared, { messages: [{ role: 'user', content: 'A3 bounded reviewer scenario', timestamp: Date.now() }] }, { apiKey: 'local-scenario-key', maxTokens: 100 });
      expect(result.content).toContainEqual(expect.objectContaining({ type: 'text', text: '{"decision":"complete","scenario_only":true}' }));
      expect(seen).toHaveLength(1); expect(seen[0].path).toBe('/v1/chat/completions');
      expect(getApiProvider('openai-completions')).toBe(previousPublic);
    } finally {
      if (!previousAlias) unregisterApiProviders(getCustomApiRegistrySourceId(alias));
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 30_000);
});
