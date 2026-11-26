import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject, enableCollaborationFixtureVisibility } from './fixtures/session-collaboration';
import type { SessionCollaborationMessageReceipt, SessionCollaborationMessagePage } from '../../shared/types/session-collaboration-message';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';

test('durable message replay survives a Gateway restart without a second target turn', async ({ launchElectronApp }, info) => {
  test.setTimeout(360_000);
  const provider = await startScriptedLlm(() => ({ text: 'Recorded reply from the receiver.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const alpha = await createCollaborationProject(app, info.outputPath('alpha'), 'Delivery Alpha');
    await createCollaborationProject(app, info.outputPath('beta'), 'Delivery Beta'); await enableCollaborationFixtureVisibility(app);
    const sender = await hostInvoke<{ source: { scope: AutonomySessionScope } }>(app, 'sessions', 'collaborationSender');
    const input = { id: randomUUID(), target: alpha.scope, purpose: 'request', message: 'Reply with the existing source context.', expectedSource: sender.source.scope };
    const modelCallsBeforeSend = provider.log.length;
    const first = await hostInvoke<{ success: boolean; receipt: SessionCollaborationMessageReceipt }>(app, 'sessions', 'sendCollaborationMessage', input);
    expect(first.success).toBe(true);
    if (first.receipt.run) await hostInvoke(app, 'gateway', 'rpc', { method: 'agent.wait', params: { runId: first.receipt.run.runId, timeoutMs: 60_000 }, timeoutMs: 65_000 });
    await expect.poll(() => provider.log.length).toBe(modelCallsBeforeSend + 1);
    const modelCalls = provider.log.length;
    await hostInvoke(app, 'gateway', 'stop'); await startGateway(app);
    const replay = await hostInvoke<typeof first>(app, 'sessions', 'sendCollaborationMessage', input);
    expect(replay.receipt.message.createdAt).toBe(first.receipt.message.createdAt); expect(replay.receipt.message.payloadDigest).toBe(first.receipt.message.payloadDigest);
    expect(provider.log.length).toBe(modelCalls);
    const changed = await hostInvoke<{ success: boolean; phase: string }>(app, 'sessions', 'sendCollaborationMessage', { ...input, message: 'Changed body' });
    expect(changed.success).toBe(false); expect(changed.phase).toBe('rejected');
    const read = await hostInvoke<{ messages: SessionCollaborationMessagePage }>(app, 'sessions', 'collaborationMessages', { requester: sender.source.scope, target: alpha.scope, id: input.id });
    expect(read.messages.receipt?.message.payloadDigest).toBe(first.receipt.message.payloadDigest);
    expect(read.messages.receipt).toMatchObject({ phase: 'replied', reply: { text: 'Recorded reply from the receiver.' } });
    await writeFile(info.outputPath('delivery-replay.json'), JSON.stringify({ driven_by: 'agent', actor: 'session-collaboration-delivery', first, replay, changed, read,
      modelCallsBeforeSend, modelCallsBeforeReplay: modelCalls, modelCallsAfterReplay: provider.log.length }, null, 2));
  } finally { await closeElectronApp(app); await provider.close(); }
});
