/**
 * F6 — reasoning must be visible over both real channels: thinking deltas
 * while streaming (shimmer panel) and thinking content blocks in the final
 * message (collapsed summary that survives the history reload).
 */
import { expect, test } from '@playwright/test';
import { openScenario, sendMessage } from './helpers';

test('thinking streams live, then folds into a summary', async ({ page }) => {
  await openScenario(page, 'thinking');
  await sendMessage(page, '排查 auth 中间件');

  // Live path: the reasoning panel appears while the run is still thinking,
  // with the shimmer label and the streamed thought text.
  const panel = page.getByTestId('assistant-reasoning-panel');
  await expect(panel.first()).toBeVisible({ timeout: 20_000 });
  // Scope to the panel — the execution graph's trailing indicator shimmers the
  // same word, and this spec locks the reasoning panel specifically.
  await expect(panel.first().getByText('思考中')).toBeVisible();
  await expect(page.getByText('jwt.verify 的调用点').first()).toBeVisible();

  // History path: after the run ends the final message carries real thinking
  // blocks, so the panel persists as a collapsed "已思考/思考了…" summary.
  await expect(page.getByText('推理过程通过真实的')).toBeVisible({ timeout: 20_000 });
  const settled = page.getByTestId('assistant-reasoning-panel').last();
  await expect(settled).toBeVisible();
  await expect(settled.getByRole('button', { name: '展开/收起思考过程' })).toHaveText(/已思考|思考了/);

  // The summary re-opens on demand.
  await settled.getByRole('button', { name: '展开/收起思考过程' }).click();
  await expect(settled.getByText('准备把算法固定为 HS256').first()).toBeVisible();
});
