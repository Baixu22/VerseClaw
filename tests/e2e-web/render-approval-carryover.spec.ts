/**
 * F4 + F5 — an undecided host approval must survive the next turn, and a
 * pending approval must force the turn summary open (it blocks the run; the
 * user must never have to know to expand a disclosure to find it).
 */
import { expect, test } from '@playwright/test';
import { openScenario, pendingApprovalCards, sendMessage } from './helpers';

test('an undecided approval stays visible and decidable across turns', async ({ page }) => {
  await openScenario(page, 'carryover');
  await sendMessage(page, '第一轮：抛出审批');

  // Round 1 raises the approval and finishes without resolving it. With the
  // run over there is no run card left to own it, so the standalone fallback
  // surface renders it — an approval must NEVER be invisible.
  await expect(page.getByTestId('chat-run-pending-approvals')).toBeVisible({ timeout: 20_000 });
  await expect(pendingApprovalCards(page)).toHaveCount(1);

  // Round 2 — a plain reply that never touches the approval.
  await sendMessage(page, '第二轮：正常消息');
  await expect(page.getByText('这是新的一轮')).toBeVisible({ timeout: 20_000 });

  // The approval from round 1 is still there, exactly once, still decidable.
  await expect(page.getByTestId('chat-run-pending-approvals')).toBeVisible();
  await expect(pendingApprovalCards(page)).toHaveCount(1);
  await expect(
    pendingApprovalCards(page).getByRole('button', { name: '批准' }),
  ).toBeEnabled();
});
