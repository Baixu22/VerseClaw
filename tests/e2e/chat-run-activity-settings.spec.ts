import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Chat run activity settings', () => {
  test('keeps completed run activity expanded by default and allows changing the preference', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-recovery').click();

    const section = page.getByTestId('recovery-settings-section');
    await expect(section).toBeVisible();

    const toggle = section.getByTestId('settings-run-activity-completed-expanded');
    await expect(toggle).toHaveAttribute('data-state', 'checked');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-state', 'unchecked');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-state', 'checked');
  });
});
