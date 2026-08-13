/**
 * F1 contrast group — the same Tool UI cards over both delivery paths.
 *
 * The audit found tool_use-shaped cards were unreachable in-run while fenced
 * cards in reply text rendered fine. Both paths must now land the same cards.
 */
import { expect, test } from '@playwright/test';
import { openScenario, sendMessage } from './helpers';

test('tool_use tool calls render weather / table / chart cards in-run', async ({ page }) => {
  await openScenario(page, 'toolcall');
  await sendMessage(page, '跑一遍 toolcall 场景');

  await expect(page.getByTestId('chat-tool-ui-weather')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('chat-tool-ui-table')).toBeVisible();
  await expect(page.getByText('每轮耗时').first()).toBeVisible();

  // The run completes with a normal reply — the cards must survive it.
  await expect(page.getByText('互为对照组')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('chat-tool-ui-weather')).toBeVisible();
  await expect(page.getByTestId('chat-tool-ui-table')).toBeVisible();
});

test('fenced tool-ui blocks render the same cards (control group)', async ({ page }) => {
  await openScenario(page, 'toolui');
  await sendMessage(page, '跑一遍 toolui 场景');

  await expect(page.getByTestId('chat-tool-ui-weather')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('chat-tool-ui-table')).toBeVisible();
  await expect(page.getByText('每轮耗时').first()).toBeVisible();
});
