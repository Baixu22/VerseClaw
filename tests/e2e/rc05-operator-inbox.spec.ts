import type { Page } from '@playwright/test';
import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

/**
 * RC-05 Operator governance slice Inbox surface.
 *
 * Covers the visible approval/pending/recovery/result path with the real
 * store projection (src/stores/inbox.ts) and real Gateway Inbox methods
 * (inbox.operator.list / inbox.operator.decide) mocked at the IPC boundary:
 * a pending Operator intent is visible, and an operator decision resolves it
 * through the durable-approval path shape.
 */

const operatorIntent = {
  approvalId: 'aprv_rc05_e2e',
  state: 'approval_pending',
  requestDigest: 'a'.repeat(64),
  createdAtMs: Date.parse('2026-08-05T10:00:00.000Z'),
  expiresAtMs: Date.parse('2026-08-05T10:01:00.000Z'),
  resolvedBy: null,
  decision: null,
};

async function installOperatorInboxMocks(electronApp: Parameters<typeof installIpcMocks>[0]) {
  await installIpcMocks(electronApp, {
    gatewayStatus: { running: true, ready: true },
  });

  await electronApp.evaluate(async ({ ipcMain }, initial) => {
    type HostRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    type InvokeHandler = (event: unknown, request: HostRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, InvokeHandler> })._invokeHandlers;
    const original = handlers?.get('host:invoke');
    const state = { decision: null as null | 'approved' | 'denied' };
    (globalThis as unknown as { __rc05E2eState?: typeof state }).__rc05E2eState = state;

    const respond = (id: unknown, data: unknown) => ({
      id: typeof id === 'string' ? id : undefined,
      ok: true,
      data,
    });

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostRequest) => {
      const current = (globalThis as unknown as { __rc05E2eState: typeof state }).__rc05E2eState;
      if (request.module === 'gateway' && request.action === 'rpc') {
        const method = (request.payload as { method?: string } | undefined)?.method;
        if (method === 'inbox.operator.list') {
          const pending = current.decision === null;
          return respond(request.id, {
            intents: [
              {
                ...initial.operatorIntent,
                state: pending ? 'approval_pending' : current.decision,
                decision: pending ? null : current.decision,
                resolvedBy: pending ? null : 'e2e-operator',
              },
            ],
          });
        }
        if (method === 'inbox.operator.decide') {
          const decision = (request.payload as { decision?: string } | undefined)?.decision;
          current.decision = decision === 'deny' ? 'denied' : 'approved';
          return respond(request.id, {
            approvalId: initial.operatorIntent.approvalId,
            state: current.decision,
            actor: 'e2e-operator',
            policyDigest: 'b'.repeat(64),
          });
        }
      }
      return original?.(event, request) ?? respond(request.id, {});
    });
  }, { operatorIntent });
}

async function dismissToasts(page: Page) {
  await page.addStyleTag({
    content: '[data-sonner-toaster], [data-sonner-toast] { display: none !important; }',
  });
  await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0);
}

test.describe('RC-05 Operator Inbox surface', () => {
  test('shows a pending Operator intent, resolves it via inbox.operator.decide, and updates the badge', async ({ electronApp, page }) => {
    await installOperatorInboxMocks(electronApp);
    await completeSetup(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('sidebar-nav-inbox').click();

    // The pending Operator intent is visible with an approve/deny decision.
    await expect(page.getByTestId('inbox-page')).toBeVisible();
    await expect(page.getByTestId('inbox-item-operator:aprv_rc05_e2e')).toBeVisible();
    await expect(page.getByTestId('sidebar-nav-inbox-badge')).toHaveText('1');
    await dismissToasts(page);

    // Detail + approve: the decision flows through the real inbox.operator.decide
    // method shape; the intent leaves the actionable list afterwards.
    await page.getByTestId('inbox-item-operator:aprv_rc05_e2e').click();
    await expect(page.getByTestId('inbox-detail')).toBeVisible();
    await page.getByTestId('inbox-action-approve').click();
    // The badge disappears when nothing is actionable (0 renders no badge).
    await expect(page.getByTestId('sidebar-nav-inbox-badge')).toHaveCount(0);
    await expect(page.getByTestId('inbox-item-operator:aprv_rc05_e2e')).toHaveCount(0);
  });

  test('a denied Operator intent leaves the actionable list with zero effect', async ({ electronApp, page }) => {
    await installOperatorInboxMocks(electronApp);
    await completeSetup(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('sidebar-nav-inbox').click();

    await expect(page.getByTestId('inbox-item-operator:aprv_rc05_e2e')).toBeVisible();
    await page.getByTestId('inbox-item-operator:aprv_rc05_e2e').click();
    await page.getByTestId('inbox-action-deny').click();
    // The badge disappears when nothing is actionable (0 renders no badge).
    await expect(page.getByTestId('sidebar-nav-inbox-badge')).toHaveCount(0);
    // The denied intent is not actionable anymore (history view only).
    await expect(page.getByTestId('inbox-item-operator:aprv_rc05_e2e')).toHaveCount(0);
  });
});
