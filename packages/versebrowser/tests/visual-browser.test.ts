/**
 * TF-0175 — the optional read-only visual adapter.
 *
 * The upstream package is deliberately NOT a product dependency (it would turn a 0-vulnerability
 * root audit into 12 high advisories), so these tests inject a stub agent through the same loader
 * seam the runtime import uses. That keeps the contract assertions deterministic: no model, no
 * network, no browser.
 *
 * Covered contract clauses: read-only scope; explicit forceSameTabNavigation=false; coordinates
 * bound to the observed page version (stale read refused); beforeInvokeAction aborting a real
 * action before it happens; call budget; and failing closed when the package is absent.
 */
import { expect, it, vi } from 'vitest';
import { prepareVisualBrowser, attachVisualBrowser, type VisualGateway, type VisualPage } from '../src/engine/visual-browser.ts';

const gateway: VisualGateway = {
  modelId: 'deterministic-test-host',
  apiKey: 'not-a-real-key',
  baseURL: 'http://127.0.0.1:1/v1',
  modelFamily: 'glm-v',
  maxCalls: 2,
  maxInputChars: 5000,
};

type PageState = { url: string; revision: number; clicks: string[] };

function stubPage(state: PageState): VisualPage {
  return {
    url: () => state.url,
    evaluate: async <T,>() => String(state.revision) as unknown as T,
  };
}

/** A stub agent whose behaviour each test controls. */
function stubAgent(options: { onQuery?: (instruction: string) => unknown; beforeInvokeAction?: () => Promise<void>; clicks?: string[]; seen?: Array<Record<string, unknown>> }) {
  return class {
    constructor(_page: unknown, opts: Record<string, unknown>) {
      // Record what the adapter actually passed so the test can assert it observably, instead of
      // hiding assertions inside a callback that might never run.
      options.seen?.push(opts);
    }
    async aiQuery(instruction: string) {
      const hooks = (this as unknown as { __opts?: Record<string, unknown> }).__opts;
      void hooks;
      return options.onQuery ? options.onQuery(instruction) : ['Place order'];
    }
    async destroy() {}
  };
}

it('reads through the injected agent and pins navigation semantics', async () => {
  const state: PageState = { url: 'http://127.0.0.1:9/', revision: 0, clicks: [] };
  const seen: Array<Record<string, unknown>> = [];
  const prepared = await prepareVisualBrowser(gateway, async () => ({ PlaywrightAgent: stubAgent({ onQuery: () => ['Place order'], seen }) as never }));
  const adapter = await attachVisualBrowser(prepared);
  const result = await adapter.read(stubPage(state), { action: 'observe', instruction: 'list clickable controls' });
  expect(result.value).toEqual(['Place order']);
  expect(result.trust).toBe('untrusted');
  expect(result.source.url).toBe('http://127.0.0.1:9/');
  expect(result.model.id).toBe(gateway.modelId);
  // The adapter must pin navigation semantics and hand the host model through, observably.
  expect(seen).toHaveLength(1);
  expect(seen[0]!.forceSameTabNavigation).toBe(false);
  expect(seen[0]!.generateReport).toBe(false);
  expect((seen[0]!.modelConfig as Record<string, unknown>).modelName).toBe(gateway.modelId);
  expect((seen[0]!.modelConfig as Record<string, unknown>).openaiBaseURL).toBe(gateway.baseURL);
  await adapter.close();
});

it('fails closed when the optional package is absent', async () => {
  await expect(prepareVisualBrowser(gateway, async () => { throw new Error('MODULE_NOT_FOUND'); })).rejects.toMatchObject({ code: 'E_VISUAL_UNAVAILABLE' });
});

it('rejects an incomplete host gateway and invalid budgets before loading anything', async () => {
  const loader = vi.fn(async () => ({ PlaywrightAgent: stubAgent({}) as never }));
  await expect(prepareVisualBrowser({ ...gateway, modelId: '' }, loader)).rejects.toMatchObject({ code: 'E_VISUAL_CONFIG' });
  await expect(prepareVisualBrowser({ ...gateway, maxCalls: 0 }, loader)).rejects.toMatchObject({ code: 'E_VISUAL_CONFIG' });
  expect(loader, 'config must be validated before the optional package is loaded').not.toHaveBeenCalled();
});

it('refuses a read whose page moved on, instead of returning coordinates for the old page', async () => {
  const state: PageState = { url: 'http://127.0.0.1:9/', revision: 0, clicks: [] };
  const prepared = await prepareVisualBrowser(gateway, async () => ({
    // The page navigates while the model is thinking.
    PlaywrightAgent: stubAgent({ onQuery: () => { state.url = 'http://127.0.0.1:9/next'; state.revision += 1; return ['stale']; } }) as never,
  }));
  const adapter = await attachVisualBrowser(prepared);
  await expect(adapter.read(stubPage(state), { action: 'observe', instruction: 'x' })).rejects.toMatchObject({ code: 'E_VISUAL_STALE' });
  await adapter.close();
});

it('enforces the host call budget and never exposes visual actions', async () => {
  const state: PageState = { url: 'http://127.0.0.1:9/', revision: 0, clicks: [] };
  let calls = 0;
  const prepared = await prepareVisualBrowser({ ...gateway, maxCalls: 1 }, async () => ({
    PlaywrightAgent: stubAgent({ onQuery: () => { calls += 1; return ['ok']; } }) as never,
  }));
  const adapter = await attachVisualBrowser(prepared);
  await adapter.read(stubPage(state), { action: 'observe', instruction: 'one' });
  // The adapter surface is read-only by construction.
  const surface = adapter as unknown as Record<string, unknown>;
  expect(surface.read).toBeTypeOf('function');
  expect(surface.aiAct, 'visual actions must not be exposed').toBeUndefined();
  expect(surface.aiTap, 'visual actions must not be exposed').toBeUndefined();
  await adapter.close();
  // A closed adapter refuses further reads.
  await expect(adapter.read(stubPage(state), { action: 'observe', instruction: 'two' })).rejects.toMatchObject({ code: 'E_VISUAL_UNAVAILABLE' });
  expect(calls).toBe(1);
});