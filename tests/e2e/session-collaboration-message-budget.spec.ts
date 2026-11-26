import { randomUUID } from 'node:crypto';
import { closeElectronApp, expect, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject } from './fixtures/session-collaboration';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';
test('status bursts reuse an original intent without an additional target model call', async ({ launchElectronApp }, info) => {
  test.setTimeout(180_000);
  const provider = await startScriptedLlm(() => ({ text: 'Status received.' })), app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const project = await createCollaborationProject(app, info.outputPath('status'), 'Status project');
    const sender = await hostInvoke<{ source: { scope: AutonomySessionScope } }>(app, 'sessions', 'collaborationSender');
    const input = { id: randomUUID(), expectedSource: sender.source.scope, target: project.scope, purpose: 'status', message: 'One source-backed status update.' };
    const first = await hostInvoke<{ receipt: { message: { id: string }; run: { runId: string } | null } }>(app, 'sessions', 'sendCollaborationMessage', input);
    if (first.receipt.run) await hostInvoke(app, 'gateway', 'rpc', { method: 'agent.wait', params: { runId: first.receipt.run.runId, timeoutMs: 60_000 }, timeoutMs: 65_000 });
    const calls = provider.log.length;
    const next = await hostInvoke<{ receipt: { coalescedTo?: string } }>(app, 'sessions', 'sendCollaborationMessage', { ...input, id: randomUUID() });
    expect(next.receipt.coalescedTo).toBe(first.receipt.message.id); expect(provider.log.length).toBe(calls);
  } finally { await closeElectronApp(app); await provider.close(); }
});
