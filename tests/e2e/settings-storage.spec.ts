import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Verse Claw storage cleaner settings', () => {
  test('renders system info cards and category blocks after scan', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByTestId('settings-sidebar')).toBeVisible();

    await page.getByTestId('settings-nav-storage').click();
    await expect(page.getByTestId('settings-storage-section')).toBeVisible();

    await expect(page.getByTestId('storage-info-ram')).toBeVisible();
    await expect(page.getByTestId('storage-info-disk')).toBeVisible();
    await expect(page.getByTestId('storage-info-cpu')).toBeVisible();

    await page.getByTestId('storage-scan-refresh').click();

    await expect(page.getByTestId('storage-category-logs')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('storage-category-sessions')).toBeVisible();
    await expect(page.getByTestId('storage-category-trash')).toBeVisible();

    await expect(page.getByTestId('storage-ask-agent-button')).toBeVisible();
    const selectableItem = page.locator('[data-testid^="storage-item-checkbox-"]:not([disabled])').first();
    const selectableCount = await selectableItem.count();
    if (selectableCount > 0) {
      await selectableItem.check();
      await expect(page.getByTestId('storage-delete-button')).toBeVisible();
    } else {
      await expect(page.getByTestId('storage-delete-button')).toHaveCount(0);
    }
  });

  test('navigates to chat when ask agent button is clicked', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-storage').click();
    await expect(page.getByTestId('settings-storage-section')).toBeVisible();

    await page.getByTestId('storage-scan-refresh').click();
    await expect(page.getByTestId('storage-category-logs')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('storage-ask-agent-button').click();

    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
  });
});
