/**
 * Phase 0 residual risk — the shared render projection decides row visibility,
 * and the row container carries contentVisibility sizing hints. If the two
 * disagree, the transcript grows blank placeholder rows (reserved height with
 * nothing in them) or zero-height mounted rows. Neither may exist.
 */
import { expect, test } from '@playwright/test';
import { openScenario, pendingApprovalCards, sendMessage } from './helpers';

test('a settled full run leaves no empty or zero-height message rows', async ({ page }) => {
  await openScenario(page, 'full');
  await sendMessage(page, '全量冒烟');

  await expect(page.getByTestId('chat-run-pending-approvals')).toBeVisible({ timeout: 20_000 });
  await pendingApprovalCards(page).getByRole('button', { name: '批准' }).click();
  await expect(page.getByText('Tool UI 卡片总览').first()).toBeVisible({ timeout: 30_000 });

  const offenders = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid]')).filter((el) =>
      /^chat-message-\d+$/.test(el.getAttribute('data-testid') ?? ''),
    );
    return rows
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent ?? '').trim();
        const hasVisualContent = el.querySelector('img, svg, canvas, video, button, [data-slot]') != null;
        const zeroHeight = rect.height === 0;
        const blankPlaceholder = rect.height > 0 && text.length === 0 && !hasVisualContent;
        return zeroHeight || blankPlaceholder
          ? { testid: el.getAttribute('data-testid'), height: rect.height, textLength: text.length }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);
  });

  expect(offenders, `empty/zero-height rows: ${JSON.stringify(offenders)}`).toEqual([]);
});
