/**
 * Shared helpers for the web render specs.
 *
 * Every spec drives the real app served by vite.web.config.ts with the mock
 * host bridge (`?mock=1&script=<scenario>`). The mock state is module-level in
 * the page, so each `page.goto` starts from a clean transcript — no cross-spec
 * bleed even under full parallelism.
 */
import { expect, type Page } from '@playwright/test';

export async function openScenario(page: Page, scenario?: string): Promise<void> {
  const query = scenario ? `/?mock=1&script=${scenario}#/` : '/?mock=1#/';
  await page.goto(query);
  // The composer only renders once settings + workspace fixtures have landed.
  await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 20_000 });
}

/** Types into the composer and sends — the entry point of every scripted run. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('chat-composer-input');
  await input.click();
  await input.fill(text);
  await page.getByTestId('chat-composer-send').click();
}

/** Pending (undecided) host approval cards — excludes decided receipts. */
export function pendingApprovalCards(page: Page) {
  return page.locator('[data-slot="approval-card"]:not([data-receipt="true"])');
}
