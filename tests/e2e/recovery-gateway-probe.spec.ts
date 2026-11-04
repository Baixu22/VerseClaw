import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getStableWindow, test } from './fixtures/electron';
import { buildMockProviderConfig, hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';

test('gateway probe', async ({ homeDir, userDataDir, launchElectronApp }) => {
  test.setTimeout(180_000);
  const llm = await startScriptedLlm(() => ({ text: 'ok' }));
  const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-gateway-probe-'));
  const openclawDir = join(homeDir, '.openclaw');
  const sourceStateDir = join(userDataDir, 'openclaw-source-state');
  await mkdir(openclawDir, { recursive: true });
  await mkdir(sourceStateDir, { recursive: true });
  const serialized = `${JSON.stringify(buildMockProviderConfig(llm.port, workspaceDir), null, 2)}\n`;
  await writeFile(join(openclawDir, 'openclaw.json'), serialized, 'utf8');
  await writeFile(join(sourceStateDir, 'openclaw.json'), serialized, 'utf8');
  const app = await launchElectronApp({ skipSetup: true });
  await getStableWindow(app);
  console.log('PROBE workspace', workspaceDir);
  for (let i = 0; i < 6; i += 1) {
    const started = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'start').catch((error) => ({ error: String(error) }));
    const status = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'status').catch((error) => ({ statusError: String(error) }));
    console.log('PROBE', JSON.stringify({ i, started, status }));
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  const { closeElectronApp } = await import('./fixtures/electron');
  await closeElectronApp(app).catch(() => undefined);
  await new Promise<void>((resolve) => llm.server.close(() => resolve()));
});
