// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SCRIPTED_LLM_USAGE, startScriptedLlm } from '../e2e/fixtures/fp-p1-harness';

describe('scripted provider usage receipts', () => {
  it.each([false, true])('preserves explicit usage and ordinary defaults with stream=%s', async stream => {
    const overrun = { prompt_tokens: 100000, completion_tokens: 30, total_tokens: 100030 };
    const llm = await startScriptedLlm(text => text === 'overrun' ? { text: 'invalid JSON', usage: overrun } : { text: 'ordinary reply' });
    try {
      for (const [message, expected] of [['overrun', overrun], ['normal', SCRIPTED_LLM_USAGE]] as const) {
        const response = await fetch(`http://127.0.0.1:${llm.port}/v1/chat/completions`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ stream, messages: [{ role: 'user', content: message }] }),
        });
        expect(response.status).toBe(200);
        const body = await response.text();
        const receipt = stream
          ? body.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6))).find(chunk => chunk.usage)
          : JSON.parse(body);
        expect(receipt.usage).toEqual(expected);
      }
      expect(llm.anomalies).toEqual([]);
    } finally {
      llm.server.closeAllConnections();
      await new Promise<void>((resolve, reject) => llm.server.close(error => error ? reject(error) : resolve()));
    }
  });
});
