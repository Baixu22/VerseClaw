/**
 * F8b/F8c/T9 baseline — every surface has exactly one renderer. The host
 * approval renders once (not also as a graph row), and a promoted command
 * renders as a terminal card without leaving its tool.started twin behind.
 */
import { expect, test } from '@playwright/test';
import { openScenario, pendingApprovalCards, sendMessage } from './helpers';

const COMMAND = 'run-surface-promotion.test.ts';

test('full run: approval renders once, promoted rows leave no graph twins', async ({ page }) => {
  await openScenario(page, 'full');
  await sendMessage(page, '全量冒烟');

  // Host approval: exactly one card, forced open (F5 — a pending approval
  // overrides collapse), and no duplicate row inside the graph.
  await expect(page.getByTestId('chat-run-pending-approvals')).toBeVisible({ timeout: 20_000 });
  await expect(pendingApprovalCards(page)).toHaveCount(1);
  await expect(page.getByTestId('chat-turn-summary-details')).toBeVisible();
  await expect(
    page.getByTestId('chat-execution-step').filter({ hasText: 'Permission required' }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId('chat-execution-step').filter({ hasText: '需要授权' }),
  ).toHaveCount(0);

  // Approve so the run can finish.
  await pendingApprovalCards(page).getByRole('button', { name: '批准' }).click();
  await expect(page.getByText('Tool UI 卡片总览').first()).toBeVisible({ timeout: 30_000 });

  // The summary collapses once the reply lands — reopen it to audit the run
  // surfaces in their settled state.
  await page.getByTestId('chat-turn-summary-toggle').click();

  // The promoted command owns exactly one terminal card…
  await expect(page.getByTestId('chat-run-terminal')).toHaveCount(1);
  // …and its tool.started twin was promoted out of the graph (F8b).
  await expect(
    page.getByTestId('chat-execution-step').filter({ hasText: COMMAND }),
  ).toHaveCount(0);
});
