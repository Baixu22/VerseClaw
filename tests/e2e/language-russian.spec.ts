import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Russian language localization', () => {
  test('shows Russian language option in setup wizard', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();

    try {
      const page = await getStableWindow(app);

      // Should see the setup wizard
      await expect(page.getByTestId('setup-page')).toBeVisible();

      // Should have Russian language button visible
      const russianButton = page.locator('button', { hasText: 'Русский' });
      await expect(russianButton).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('can switch to Russian language in setup wizard', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('setup-page')).toBeVisible();

      // Click Russian language button
      const russianButton = page.locator('button', { hasText: 'Русский' });
      await russianButton.click();

      // Verify UI renders in Russian by checking for Russian-only text
      // "Добро пожаловать" is unique to Russian and won't appear in English
      await expect(page.locator('h2')).toContainText('Добро пожаловать');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Russian language persists after skipping setup', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('setup-page')).toBeVisible();

      // Switch to Russian
      const russianButton = page.locator('button', { hasText: 'Русский' });
      await russianButton.click();

      // Skip setup
      await page.getByTestId('setup-skip-button').click();
      await expect(page.getByTestId('main-layout')).toBeVisible();

      // Navigate to Settings to verify language persistence
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();

      // The settings route renders its own sidebar (SettingsSidebar), so the
      // persistence check targets that surface. "Общие" is Russian-only;
      // the English section title is "General".
      await expect(page.getByTestId('settings-nav-general')).toContainText('Общие');

      // The document language must track the active locale, not stay at the
      // initial value (issue #49).
      await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('can switch to Russian in Settings page', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      // Navigate to Settings (in English by default after skipSetup)
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await page.getByTestId('settings-nav-general').click();

      // The Settings language control is a dropdown (SettingsSelect), not the
      // button row the setup wizard uses — open it and pick Russian.
      await page.getByTestId('settings-language-select').click();
      await page.getByRole('option', { name: 'Русский' }).click();

      // Verify the settings sidebar switched to Russian. "Общие" is
      // Russian-only; the English section title is "General".
      await expect(page.getByTestId('settings-nav-general')).toContainText('Общие');

      await page.getByTestId('settings-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Инструменты' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Навыки' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'MCP-сервисы' })).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
