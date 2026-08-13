/**
 * F10 + F5 — a plan-only run must not render an empty execution-graph shell,
 * and the collapsed turn summary must carry a plan badge so the content is
 * discoverable without expanding.
 */
import { expect, test } from '@playwright/test';
import { openScenario, sendMessage } from './helpers';

test('plan-only run: badge on collapsed header, plan card on expand, no empty graph', async ({ page }) => {
  await openScenario(page, 'planonly');
  await sendMessage(page, '只做计划');

  // Wait for the run to settle — the summary collapses once the reply lands.
  await expect(page.getByText('这一轮只产出了计划')).toBeVisible({ timeout: 20_000 });

  // The orb must SETTLE: a completed run renders the emerald check matrix,
  // not the still-breathing canvas orb (the "looks like it never finished" bug).
  const orb = page.getByTestId('chat-turn-summary-orb');
  await expect(orb.locator('[data-slot="dot-matrix"][data-state="success"]')).toBeVisible({ timeout: 10_000 });
  await expect(orb.locator('canvas')).toHaveCount(0);

  // Collapsed header advertises the plan (zh: "3 步计划").
  const planBadge = page.getByTestId('chat-turn-summary-badge-plan');
  await expect(planBadge).toBeVisible({ timeout: 10_000 });
  await expect(planBadge).toHaveText(/3/);

  // Expand → the plan card is there, and there is no execution-graph shell:
  // every graph row was promoted away, so the shell must render null (F10).
  await page.getByTestId('chat-turn-summary-toggle').click();
  await expect(page.getByTestId('chat-run-plan')).toBeVisible();
  await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
});
