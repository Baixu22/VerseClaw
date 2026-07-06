import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Verse Claw storage cleaner settings', () => {
  test('renders system info cards and category blocks after scan', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByTestId('settings-overview')).toBeVisible();

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
    await expect(page.getByTestId('storage-delete-button')).toBeVisible();
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
