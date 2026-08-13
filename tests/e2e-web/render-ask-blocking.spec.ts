/**
 * F1's worst symptom — a run blocked on a question_flow tool call with no
 * final reply. Before the fix the page showed nothing and the run looked hung;
 * now the question card must be visible and actionable.
 */
import { expect, test } from '@playwright/test';
import { openScenario, sendMessage } from './helpers';

test('a question-blocked run shows an interactive question card', async ({ page }) => {
  await openScenario(page, 'ask');
  await sendMessage(page, '发布这个版本');

  // The question card appears even though the run never finishes.
  const flow = page.getByTestId('chat-tool-ui-question-flow');
  await expect(flow).toBeVisible({ timeout: 20_000 });
  // Heading role — the raw question text also appears in the graph's tool row.
  await expect(flow.getByRole('heading', { name: '要发布到哪个环境？' })).toBeVisible();

  // Pick an option; with the run still active the submit path is the
  // composer-draft ("插入答复") button.
  await page.getByTestId('chat-tool-ui-question-option-staging').click();
  const insert = page.getByTestId('chat-tool-ui-action-insert');
  await expect(insert).toBeVisible();
  await insert.click();

  // The structured response landed in the composer — the user has a way out,
  // so the run is not a dead end.
  await expect(page.getByTestId('chat-composer-input')).toHaveValue(/staging/);
});
