import { completeSetup, expect, test } from './fixtures/electron';

async function expectSiliconFlowDefaultModel(page: import('@playwright/test').Page) {
  const modelInput = page.getByTestId('add-provider-model-id-input');
  const modelValue = page.getByText('deepseek-ai/DeepSeek-V3', { exact: true }).first();
  await expect(modelInput.or(modelValue)).toBeVisible();
  if (await modelInput.isVisible().catch(() => false)) {
    await expect(modelInput).toHaveValue('deepseek-ai/DeepSeek-V3');
  }
}

test.describe('Verse Claw developer-mode gated UI', () => {
  test('keeps developer-only configuration hidden until dev mode is enabled', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-footer-menu-trigger').click();
    await expect(page.getByTestId('sidebar-more-observability')).toBeVisible();
    await expect(page.getByTestId('sidebar-more-image-generation')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-more-dreams')).toHaveCount(0);
    await page.getByTestId('sidebar-footer-menu-trigger').click();

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByTestId('settings-nav-developer')).toBeVisible();
    await page.getByTestId('settings-nav-developer').click();
    await expect(page.getByTestId('settings-back-button')).toBeVisible();
    await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'unchecked');
    await expect(page.getByTestId('settings-developer-gateway-token')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-open-dev-console')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-nav-dreams')).toHaveCount(0);

    await page.evaluate(() => {
      window.location.hash = '#/dreams';
    });
    await expect(page.getByTestId('dreams-page')).toHaveCount(0);
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-models').click();
    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();
    await page.getByTestId('add-provider-type-siliconflow').click();
    await expectSiliconFlowDefaultModel(page);
    await page.getByTestId('add-provider-close-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toHaveCount(0);

    await page.getByTestId('settings-nav-developer').click();
    await page.getByTestId('settings-dev-mode-switch').click();
    await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'checked');
    await expect(page.getByTestId('settings-developer-section')).toBeVisible();
    await expect(page.getByTestId('settings-developer-gateway-token')).toBeVisible();
    await page.getByTestId('settings-back-button').click();
    await page.getByTestId('sidebar-footer-menu-trigger').click();
    await expect(page.getByTestId('sidebar-open-dev-console')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-nav-dreams')).toHaveCount(0);
    await page.getByTestId('sidebar-more-dreams').click();
    await expect(page.getByTestId('dreams-page')).toBeVisible();

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-models').click();
    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();
    await page.getByTestId('add-provider-type-siliconflow').click();
    await expectSiliconFlowDefaultModel(page);
  });
});
