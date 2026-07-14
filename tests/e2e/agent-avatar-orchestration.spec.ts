import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function openAgents(page: Awaited<ReturnType<typeof getStableWindow>>) {
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await page.getByTestId('sidebar-nav-settings').click();
  await page.getByTestId('settings-nav-agents').click();
  await expect(page.getByTestId('agents-page')).toBeVisible();
}

test.describe('local Agent avatar identity', () => {
  test('persists a locally generated avatar across restart and restores the deterministic default', async ({ launchElectronApp }) => {
    let app = await launchElectronApp({ skipSetup: true });
    let page = await getStableWindow(app);

    try {
      await openAgents(page);
      await expect(page.getByTestId('agent-avatar-main')).toBeVisible();
      await expect(page.getByTestId('agent-avatar-main').locator('img')).toHaveCount(2);

      await page.getByTestId('agents-add-button').click();
      const createDialog = page.getByTestId('add-agent-dialog');
      await createDialog.locator('#agent-name').fill('Research');
      await createDialog.getByRole('button', { name: 'Save' }).click();

      const avatar = page.getByTestId('agent-avatar-research').first();
      await expect(avatar).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('agent-settings-research').click();
      await expect(page.getByTestId('agent-avatar-candidates')).toBeVisible();
      await page.getByTestId('agent-avatar-style').click();
      await page.getByRole('option', { name: 'identicon' }).click();
      await page.getByTestId('agent-avatar-candidate-2').click();
      await page.getByTestId('agent-avatar-save').click();
      await expect(page.getByText('Avatar saved')).toBeVisible();
      const savedSrc = await page.getByTestId('agent-avatar-research').first().locator('img').getAttribute('src');
      expect(savedSrc).toMatch(/^data:image\/svg\+xml/);

      await closeElectronApp(app);
      app = await launchElectronApp({ skipSetup: true });
      page = await getStableWindow(app);
      await openAgents(page);
      await expect(page.getByTestId('agent-avatar-research').first().locator('img')).toHaveAttribute('src', savedSrc!);

      await page.getByTestId('agent-settings-research').click();
      await page.getByRole('button', { name: 'Restore default' }).click();
      await expect(page.getByText('Default avatar restored')).toBeVisible();
      await expect(page.getByTestId('agent-avatar-research').first().locator('img')).not.toHaveAttribute('src', savedSrc!);
    } finally {
      await closeElectronApp(app);
    }
  });
});
