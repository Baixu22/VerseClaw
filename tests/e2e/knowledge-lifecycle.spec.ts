import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';
import type { ElectronApplication } from '@playwright/test';
import type { KnowledgeChangeOperation } from '../../shared/host-api/contract';

async function installLifecycleGatewayRpc(
  electronApp: ElectronApplication,
  operation: Exclude<KnowledgeChangeOperation, 'create'>,
): Promise<void> {
  await electronApp.evaluate(async (_electron, { lifecycleOperation }) => {
    const bundled = process.mainModule?.require?.('./dist-electron/main/index.js') as unknown as
      | { gatewayManager?: { rpc: (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown> } }
      | undefined;
    const gatewayManager = bundled?.gatewayManager;
    if (!gatewayManager || typeof gatewayManager.rpc !== 'function') {
      throw new Error('gatewayManager export unavailable for lifecycle E2E mock');
    }
    const calls: Array<{ method: string; params: unknown }> = [];
    (globalThis as unknown as { __clawxLifecycleGatewayCalls?: Array<{ method: string; params: unknown }> }).__clawxLifecycleGatewayCalls = calls;
    gatewayManager.rpc = async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === 'sessions.list') return { sessions: [] };
      if (method === 'wiki.status') return { vaultExists: true };
      if (method === 'wiki.get') {
        return {
          revision: 1,
          status: 'active',
          path: 'notes/target.md',
          title: 'Target page',
          content: '# Target page\nInitial body.',
        };
      }
      if (method === `wiki.${lifecycleOperation}`) {
        return {
          changed: true,
          revision: 2,
          status: lifecycleOperation === 'delete' ? 'deleted' : 'active',
          pagePath: 'notes/target.md',
        };
      }
      return {};
    };
  }, { lifecycleOperation: operation });
}

const LIFECYCLE_OPS: Exclude<KnowledgeChangeOperation, 'create'>[] = [
  'update',
  'merge',
  'archive',
  'revoke',
  'delete',
  'restore',
];

for (const operation of LIFECYCLE_OPS) {
  test(`Knowledge lifecycle ${operation} goes through Main wiki RPC and shows EffectReceipt`, async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    });
    await installLifecycleGatewayRpc(electronApp, operation);

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-knowledge').click();
    await expect(page.getByTestId('knowledge-page')).toBeVisible();
    await page.getByTestId('knowledge-more-actions').click();
    await page.getByTestId('knowledge-tab-review').click();
    await expect(page.getByTestId('knowledge-lifecycle')).toBeVisible();

    await page.getByTestId('knowledge-lifecycle-operation').selectOption(operation);
    await page.getByTestId('knowledge-lifecycle-target').fill('notes/target.md');
    if (operation === 'merge') {
      await page.getByTestId('knowledge-lifecycle-merge-source').fill('notes/source.md');
    }
    await page.getByTestId('knowledge-lifecycle-title').fill(`E2E ${operation}`);
    await page.getByTestId('knowledge-lifecycle-body').fill(`E2E lifecycle body for ${operation}.`);
    await page.getByTestId('knowledge-lifecycle-reason').fill(`E2E ${operation} policy decision`);
    await page.getByTestId('knowledge-lifecycle-propose').click();

    await expect(page.getByTestId('knowledge-review')).toBeVisible();
    await expect(page.getByTestId('knowledge-lifecycle-expected-revision')).toContainText('1');
    await page.getByTestId('knowledge-review-apply').click();

    await expect(page.getByTestId('knowledge-lifecycle-receipt-json')).toContainText(`"operation": "${operation}"`);
    await expect(page.getByTestId('knowledge-lifecycle-receipt-json')).toContainText('"owner": "memory-wiki"');
    await expect(page.getByTestId('knowledge-lifecycle-compensation')).toBeVisible();
    await expect(page.getByTestId('knowledge-receipt-history')).toContainText(operation);

    const gatewayCalls = await electronApp.evaluate(() => (
      (globalThis as unknown as { __clawxLifecycleGatewayCalls?: Array<{ method: string; params: unknown }> }).__clawxLifecycleGatewayCalls ?? []
    ));
    expect(gatewayCalls.some((call) => call.method === `wiki.${operation}`)).toBe(true);
  });
}
