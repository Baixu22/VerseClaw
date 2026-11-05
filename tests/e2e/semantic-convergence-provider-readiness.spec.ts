import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test('Settings validates 429 and non-auth 400 through Main without claiming verified', async ({ launchElectronApp }) => {
  const requests: Array<{ status: number; path: string }> = [];
  const endpoint = createServer((req, res) => {
    const status = req.headers.authorization?.includes('rate-fixture') ? 429 : 400;
    requests.push({ status, path: req.url ?? '' });
    req.resume();
    res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '3' });
    res.end(JSON.stringify({ error: { message: status === 429 ? 'Too many requests' : 'unsupported parameter temperature' } }));
  });
  await new Promise<void>(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  const address = endpoint.address();
  if (!address || typeof address === 'string') throw new Error('Missing endpoint address');
  let app: ElectronApplication | undefined;
  try {
    app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-models').click();
    await page.getByTestId('providers-add-button').click();
    await page.getByTestId('add-provider-type-custom').click();
    const dialog = page.getByTestId('add-provider-dialog');
    await page.getByTestId('add-provider-base-url-input').fill(`http://127.0.0.1:${address.port}/v1`);
    await page.getByTestId('add-provider-api-key-input').fill('rate-fixture');
    await dialog.getByRole('button', { name: 'Test Connection', exact: true }).click();
    await expect(dialog).toContainText('Rate limited by the provider. Retry in about 3 s.');
    await expect(dialog).not.toContainText('Credentials verified');
    await page.screenshot({ path: test.info().outputPath('settings-rate-limited.png') });
    await page.getByTestId('add-provider-api-key-input').fill('parameter-fixture');
    await dialog.getByRole('button', { name: 'Test Connection', exact: true }).click();
    await expect(dialog).toContainText('The endpoint rejected the request format. Check the Base URL and API protocol.');
    await expect(dialog).not.toContainText('Credentials verified');
    await page.screenshot({ path: test.info().outputPath('settings-protocol-error.png') });
    expect(requests.some(request => request.status === 429)).toBe(true);
    expect(requests.some(request => request.status === 400 && request.path.includes('chat/completions'))).toBe(true);
    await writeFile(test.info().outputPath('provider-validation-observations.json'), JSON.stringify({
      driven_by: 'agent', actor: 'codex/tf0746', boundary: 'real Electron UI -> host-api -> Main validation -> local HTTP', requests,
      rateLimitedVerified: false, parameterErrorVerified: false,
    }, null, 2));
  } finally {
    if (app) await closeElectronApp(app);
    endpoint.closeAllConnections();
    await new Promise<void>(resolve => endpoint.close(() => resolve()));
  }
});

test('closing an Electron wrapper reaps its actual main process and preserves a second app', async ({ launchElectronApp }) => {
  const first = await launchElectronApp({ skipSetup: true });
  let second: ElectronApplication | undefined;
  const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    const secondProfile = join(process.env.CLAWX_E2E_RUN_ROOT!, 'second-owned-profile');
    await mkdir(secondProfile, { recursive: true });
    second = await launchElectronApp({ skipSetup: true, profileDir: secondProfile });
    const wrapperPid = first.process().pid;
    const firstPid = await first.evaluate(() => process.pid);
    const secondPid = await second.evaluate(() => process.pid);
    await closeElectronApp(first);
    await expect.poll(() => isAlive(firstPid)).toBe(false);
    expect(isAlive(secondPid)).toBe(true);
    const page = await getStableWindow(second);
    await expect(page.getByTestId('main-layout')).toBeVisible();
    await writeFile(test.info().outputPath('process-close-observations.json'), JSON.stringify({
      driven_by: 'agent', actor: 'codex/tf0746', firstPid, firstAlive: false, secondPid, secondAlive: true,
      wrapperPid,
    }, null, 2));
  } finally {
    await closeElectronApp(first);
    if (second) await closeElectronApp(second);
  }
});
