import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
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
  const app = await launchElectronApp({ skipSetup: true });
  try {
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
    await closeElectronApp(app);
    endpoint.closeAllConnections();
    await new Promise<void>(resolve => endpoint.close(() => resolve()));
  }
});
