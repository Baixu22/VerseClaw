import type { Page } from '@playwright/test';

export async function openSessionNavigation(page: Page) {
  const trigger = page.getByTestId('chat-header-session-name');
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await page.getByTestId('chat-session-navigation-menu').waitFor({ state: 'visible' });
}

export async function selectDerivedSession(page: Page, key: string) {
  await openSessionNavigation(page);
  await page.getByTestId(`chat-session-derived-${key}`).click();
}

export async function openSourceSession(page: Page) {
  await openSessionNavigation(page);
  await page.getByTestId('session-family-source').click();
}
