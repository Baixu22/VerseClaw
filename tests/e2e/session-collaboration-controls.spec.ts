import { closeElectronApp, expect, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject } from './fixtures/session-collaboration';

test('original context controls reject an old generation without changing the session owner', async ({ launchElectronApp }, info) => {
  test.setTimeout(180_000);
  const provider = await startScriptedLlm(() => ({ text: 'Control fixture ready.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const project = await createCollaborationProject(app, info.outputPath('control'), 'Control project');
    const before = await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.describe', params: { key: project.sessionKey } });
    const result = await hostInvoke<{ success: boolean }>(app, 'sessions', 'compact', { sessionKey: project.sessionKey, expectedSessionId: 'old-generation' });
    expect(result.success).toBe(false);
    expect(await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.describe', params: { key: project.sessionKey } })).toEqual(before);
  } finally { await closeElectronApp(app); await provider.close(); }
});
