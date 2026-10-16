/**
 * P0 可信验收：采集失败不得静默 PASS（TFP-value-closeout / t-catch）。
 * 注入拒绝请求的 console/network 接口，verify_flow 必须 UNKNOWN/FAIL，禁止假 PASS。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';
import type { VerifyReport } from '../src/contracts/index.ts';
import { formatVerifyPrComment } from '../src/evidence/pr-comment.ts';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type MockOverrides = Partial<{
  waitForSelector: unknown;
  networkListRequests: unknown;
  getConsoleMessages: unknown;
  screenshot: unknown;
  evaluate: unknown;
}>;

function createMockApi(overrides: MockOverrides = {}): AgentBrowserHostApi {
  const base = {
    waitForSelector: async () => ({ success: true }),
    networkListRequests: async () => ({ success: true, requests: [] }),
    getConsoleMessages: async () => ({ success: true, content: '' }),
    screenshot: async () => ({
      success: true,
      dataUrl: PNG_1PX,
      format: 'png',
      session: { id: 's-mock' },
    }),
    evaluate: async () => ({ success: true, value: undefined, session: { id: 's-mock' } }),
    close: async () => ({ success: true }),
    note: async () => undefined,
  };
  return { ...base, ...overrides } as unknown as AgentBrowserHostApi;
}

async function createFacade(api: AgentBrowserHostApi): Promise<AgentBrowserFacade> {
  const root = await mkdtemp(join(tmpdir(), 'vb-collect-'));
  return new AgentBrowserFacade({ api, evidenceRoot: root });
}

function asReport(result: { data?: unknown }): VerifyReport {
  return result.data as VerifyReport;
}

describe('verify collection integrity (no silent PASS)', () => {
  let facade: AgentBrowserFacade | undefined;

  afterEach(async () => {
    if (facade) {
      await facade.close('s-mock').catch(() => undefined);
      facade = undefined;
    }
  });

  it('console + network collection failure → outcome unknown, ok false, never PASS', async () => {
    facade = await createFacade(
      createMockApi({
        getConsoleMessages: async () => {
          throw new Error('console capture refused');
        },
        networkListRequests: async () => {
          throw new Error('network capture refused');
        },
      }),
    );

    const result = await facade.verifyFlow({ sessionId: 's-mock', screenshot: false });
    const report = asReport(result);

    expect(report.outcome).toBe('unknown');
    expect(report.ok).toBe(false);
    expect(report.collection.console).toBe('failed');
    expect(report.collection.network).toBe('failed');
    expect(report.collection.overall).toBe('failed');
    expect(report.summaryMarkdown).toContain('UNKNOWN');
    expect(report.summaryMarkdown).not.toMatch(/^# verify_flow PASS/mu);
    // Empty lists must be labelled incomplete, not "none".
    expect(report.summaryMarkdown).toContain('collection incomplete');
  });

  it('network-only collection failure → still cannot PASS', async () => {
    facade = await createFacade(
      createMockApi({
        networkListRequests: async () => {
          throw new Error('net down');
        },
      }),
    );

    const report = asReport(await facade.verifyFlow({ sessionId: 's-mock', screenshot: false }));
    expect(report.outcome).toBe('unknown');
    expect(report.ok).toBe(false);
    expect(report.networkFailures.collection).toBe('failed');
    expect(report.networkFailures.collectionError).toMatch(/net down/u);
    expect(report.consoleDiff.collection).toBe('ok');
  });

  it('console-only collection failure → still cannot PASS', async () => {
    facade = await createFacade(
      createMockApi({
        getConsoleMessages: async () => {
          throw new Error('console down');
        },
      }),
    );

    const report = asReport(await facade.verifyFlow({ sessionId: 's-mock', screenshot: false }));
    expect(report.outcome).toBe('unknown');
    expect(report.ok).toBe(false);
    expect(report.consoleDiff.collection).toBe('failed');
    expect(report.networkFailures.collection).toBe('ok');
  });

  it('API success:false is treated as collection failure, not empty success', async () => {
    facade = await createFacade(
      createMockApi({
        networkListRequests: async () => ({ success: false, error: 'driver offline', requests: [] }),
        getConsoleMessages: async () => ({ success: false, error: 'driver offline', content: '' }),
      }),
    );

    const report = asReport(await facade.verifyFlow({ sessionId: 's-mock', screenshot: false }));
    expect(report.outcome).toBe('unknown');
    expect(report.ok).toBe(false);
    expect(report.collection.overall).toBe('failed');
  });

  it('healthy collection + clean signals → PASS', async () => {
    facade = await createFacade(createMockApi());

    const report = asReport(await facade.verifyFlow({ sessionId: 's-mock', screenshot: false }));
    expect(report.outcome).toBe('pass');
    expect(report.ok).toBe(true);
    expect(report.collection.overall).toBe('ok');
    expect(report.summaryMarkdown).toContain('# verify_flow PASS');
  });

  it('healthy collection + observed error → FAIL (not unknown)', async () => {
    facade = await createFacade(
      createMockApi({
        getConsoleMessages: async () => ({
          success: true,
          content: 'Uncaught error: boom',
        }),
        networkListRequests: async () => ({
          success: true,
          requests: [
            {
              id: 'r1',
              url: 'https://api.test/checkout',
              method: 'POST',
              status: 500,
              failed: true,
            },
          ],
        }),
      }),
    );

    const report = asReport(await facade.verifyFlow({ sessionId: 's-mock', screenshot: false }));
    expect(report.outcome).toBe('fail');
    expect(report.ok).toBe(false);
    expect(report.collection.overall).toBe('ok');
    expect(report.networkFailures.count).toBe(1);
    expect(report.consoleDiff.newErrors.length).toBeGreaterThan(0);
  });

  it('missing selector + collection failure → FAIL (hard evidence beats unknown)', async () => {
    facade = await createFacade(
      createMockApi({
        waitForSelector: async () => {
          throw new Error('not found');
        },
        getConsoleMessages: async () => {
          throw new Error('console down');
        },
      }),
    );

    const report = asReport(
      await facade.verifyFlow({ sessionId: 's-mock', selectors: ['#buy'], screenshot: false }),
    );
    expect(report.outcome).toBe('fail');
    expect(report.ok).toBe(false);
    expect(report.selectors[0]?.found).toBe(false);
  });

  it('PR comment shows UNKNOWN and collection notes when capture failed', async () => {
    facade = await createFacade(
      createMockApi({
        networkListRequests: async () => {
          throw new Error('net refused');
        },
      }),
    );

    const report = asReport(await facade.verifyFlow({ sessionId: 's-mock', screenshot: false }));
    const comment = formatVerifyPrComment(report, { packDir: '.ae/evidence/x' });
    expect(comment).toContain('UNKNOWN');
    expect(comment).toContain('Collection:');
    expect(comment).toContain('net refused');
    expect(comment).not.toContain('**Result:** PASS');
  });
});

describe('verify business assertions (health signals ≠ business success)', () => {
  let facade: AgentBrowserFacade | undefined;

  afterEach(async () => {
    if (facade) {
      await facade.close('s-mock').catch(() => undefined);
      facade = undefined;
    }
  });

  function mockDom(found: { text?: string; value?: string; disabled?: boolean } | null) {
    return createMockApi({
      evaluate: async (payload: { expression: string }) => {
        if (payload.expression === 'location.href') {
          return { success: true, value: 'https://shop.test/checkout', session: { id: 's-mock' } };
        }
        if (!found) return { success: true, value: { found: false }, session: { id: 's-mock' } };
        return {
          success: true,
          value: {
            found: true,
            text: found.text ?? '',
            value: found.value ?? '',
            disabled: found.disabled ?? false,
          },
          session: { id: 's-mock' },
        };
      },
    });
  }

  it('business failure (disabled CTA + error text) must FAIL even with clean signals', async () => {
    facade = await createFacade(
      mockDom({ text: 'Checkout failed', value: 'buyer@test.com', disabled: true }),
    );

    const report = asReport(
      await facade.verifyFlow({
        sessionId: 's-mock',
        screenshot: false,
        expect: [
          { type: 'enabled', selector: '#buy' },
          { type: 'text', selector: '[data-test=result]', contains: 'Order confirmed' },
        ],
      }),
    );
    expect(report.outcome).toBe('fail');
    expect(report.ok).toBe(false);
    expect(report.collection.overall).toBe('ok');
    expect(report.expectations).toHaveLength(2);
    expect(report.expectations.every((e) => !e.passed)).toBe(true);
    expect(report.summaryMarkdown).toContain('Business assertions');
  });

  it('matching business assertions + clean signals → PASS', async () => {
    facade = await createFacade(
      mockDom({ text: 'Order confirmed', value: 'buyer@test.com', disabled: false }),
    );

    const report = asReport(
      await facade.verifyFlow({
        sessionId: 's-mock',
        screenshot: false,
        expect: [
          { type: 'enabled', selector: '#buy' },
          { type: 'text', selector: '[data-test=result]', contains: 'confirmed' },
          { type: 'value', selector: '#email', equals: 'buyer@test.com' },
          { type: 'url', contains: '/checkout' },
        ],
      }),
    );
    expect(report.outcome).toBe('pass');
    expect(report.ok).toBe(true);
    expect(report.expectations.every((e) => e.passed)).toBe(true);
  });

  it('disabled assertion fails when button is enabled', async () => {
    facade = await createFacade(mockDom({ disabled: false }));
    const report = asReport(
      await facade.verifyFlow({
        sessionId: 's-mock',
        screenshot: false,
        expect: [{ type: 'disabled', selector: '#submit' }],
      }),
    );
    expect(report.outcome).toBe('fail');
    expect(report.expectations[0]?.detail).toMatch(/expected disabled/u);
  });

  it('missing selector for expectation → FAIL', async () => {
    facade = await createFacade(mockDom(null));
    const report = asReport(
      await facade.verifyFlow({
        sessionId: 's-mock',
        screenshot: false,
        expect: [{ type: 'text', selector: '#missing', contains: 'ok' }],
      }),
    );
    expect(report.outcome).toBe('fail');
    expect(report.expectations[0]?.detail).toMatch(/selector not found/u);
  });

  it('summary without expectations warns health-only, not business success', async () => {
    facade = await createFacade(createMockApi());
    const report = asReport(await facade.verifyFlow({ sessionId: 's-mock', screenshot: false }));
    expect(report.outcome).toBe('pass');
    expect(report.summaryMarkdown).toContain('health signals only');
    expect(report.summaryMarkdown).toContain('NOT business success');
  });

  it('keeps the health-only summary compact — the agent loop pays it repeatedly', async () => {
    facade = await createFacade(createMockApi());
    const report = asReport(await facade.verifyFlow({ sessionId: 's-mock', screenshot: false }));
    // Measured: 12 of 13 agent-loop verify_flow calls were health-only, each
    // returning a full ~5.8k-char acceptance report. The report is on disk.
    expect(report.summaryMarkdown.length).toBeLessThan(700);
    expect(report.summaryMarkdown).toContain('# verify_flow PASS');
    expect(report.summaryMarkdown).toContain('health signals only');
    expect(report.summaryMarkdown).toContain('NOT business success');
    // Evidence is untouched: the structured report is still complete.
    expect(report.collection.overall).toBe('ok');
    expect(report.selectors).toEqual([]);
  });

  it('keeps the full acceptance summary once expectations are requested', async () => {
    facade = await createFacade(
      mockDom({ text: 'Order confirmed', value: 'buyer@test.com', disabled: false }),
    );
    const report = asReport(
      await facade.verifyFlow({
        sessionId: 's-mock',
        screenshot: false,
        expect: [{ type: 'text', selector: '[data-test=result]', contains: 'Order confirmed' }],
      }),
    );
    expect(report.summaryMarkdown).toContain('Business assertions');
    expect(report.summaryMarkdown).toContain('## Selectors');
  });
});
