import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject, enableCollaborationFixtureVisibility, establishCollaborationScope } from './fixtures/session-collaboration';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';
import type { TaskMaterialObservation } from '../../shared/task-system/trace';
import { materialReference, type SessionCollaborationMaterialSummary } from '../../shared/types/session-collaboration-material';

test('two independent sessions compare direct reading with material reuse and preserve original receipts', async ({ launchElectronApp }, info) => {
  test.setTimeout(360_000);
  const goal = 'Return the recorded observation.';
  const result = 'measured-window: 18';
  const materialText = `Certified observation for this fixture: ${result}`;
  const sha256 = createHash('sha256').update(materialText).digest('hex');
  type Selection = Pick<SessionCollaborationMaterialSummary, 'source' | 'ref'>;
  let selected: Selection | undefined;
  const provider = await startScriptedLlm((text, tools) => {
    if (text.includes('MATERIAL-REVOKED') && selected) {
      if (!tools['revoked-material']) return { toolCall: { id: 'revoked-material', name: 'sessions_list',
        args: { materials: { target: selected.source, ref: selected.ref } } } };
      return { text: tools['revoked-material'].includes(materialText) ? 'Unexpected material' : 'Source withdrawn' };
    }
    if (text.includes('MATERIAL-REUSE')) {
      const candidates = tools['candidate-search'];
      if (!candidates) return { toolCall: { id: 'candidate-search', name: 'sessions_list', args: { materials: { search: 'Certified observation' } } } };
      const page = JSON.parse(candidates) as { items: Selection[] };
      selected = page.items[0];
      if (!selected) return { text: 'Material missing' };
      if (!tools['selected-material']) return { toolCall: { id: 'selected-material', name: 'sessions_list',
        args: { materials: { target: selected.source, ref: selected.ref } } } };
      return { text: tools['selected-material'].includes(materialText) ? result : 'Material absent from provider request' };
    }
    if (text.includes('MATERIAL-DIRECT')) {
      if (!tools['baseline-read']) return { toolCall: { id: 'baseline-read', name: 'read', args: { path: 'finding.txt' } } };
      return { text: tools['baseline-read'].includes(materialText) ? result : 'Original artifact missing' };
    }
    return { text: 'Fixture ready.' };
  });
  const app = await launchElectronApp({ skipSetup: true });
  let observations: TaskMaterialObservation[] = [];
  let presentations: TaskMaterialObservation[] = [];
  const runs: Record<string, { runId: string; status: string; text?: string; repeatedReads: number }> = {};
  try {
    await configureSessionChainProvider(app, provider.port);
    const publisher = await createCollaborationProject(app, info.outputPath('reuse-workspace'), 'Reuse workspace');
    await enableCollaborationFixtureVisibility(app);
    const reader = await hostInvoke<{ key: string; sessionId: string }>(app, 'gateway', 'rpc', { method: 'sessions.create',
      params: { agentId: 'main', label: 'Independent material reader' } });
    const consumer = { workspaceId: publisher.workspaceId, rootPath: publisher.rootPath, sessionKey: reader.key, generation: reader.sessionId };
    await hostInvoke(app, 'workspaces', 'saveState', { id: consumer.workspaceId, sessionKey: consumer.sessionKey, state: {} });
    await establishCollaborationScope(app, consumer);
    const store = new TaskSystemStore(resolveTaskDomain(publisher.rootPath));
    try {
      const sourceClaim = store.sessionSnapshot(publisher.sessionKey, publisher.generation).task?.claim;
      if (!sourceClaim) throw new Error('Original publisher claim unavailable');
      writeFileSync(join(publisher.rootPath, 'finding.txt'), materialText);
      const { task } = store.create({ objective: goal, target: 'independent-reading-result', constraints: [],
        acceptance: [{ id: 'response', description: 'Capture exact observation', verification: { kind: 'owner-receipt', owner: 'fixture' } }],
      }, 'reuse-consumer-task');
      const claim = store.claim(task.contract.taskNodeId, consumer.sessionKey, consumer.generation, 'reuse-consumer-claim').claim!;
      const fixture = store.publishSharedMaterial(sourceClaim, { id: 'repeatable-observation', kind: 'claim', summary: materialText,
        evidenceRefs: [], sensitivity: 'internal', artifactRefs: [{ path: 'finding.txt', sha256 }] },
      'agent-driven-publisher', () => publisher.scope);
      const page = await getStableWindow(app);
      await page.reload();
      await page.getByTestId('sidebar-nav-system').click();
      const materials = page.getByTestId('collaboration-materials');
      await materials.locator('summary').click();
      await materials.getByRole('button', { name: /Certified observation for this fixture/ }).click();
      await expect(materials.getByTestId('collaboration-material-detail')).toContainText(materialText);
      await expect.poll(() => {
        presentations = store.traceSnapshot(sourceClaim.taskNodeId).events.filter(event => event.kind === 'material_observation')
          .map(event => event.payload as TaskMaterialObservation);
        return presentations.some(item => item.phase === 'presented' && item.ref.contentDigest === fixture.contentDigest && item.run === null);
      }).toBe(true);
      await materials.locator('summary').click();
      const run = async (marker: string, session: typeof consumer) => {
        const start = provider.log.length;
        const response = await hostInvoke<{ runId: string }>(app, 'gateway', 'rpc', { method: 'sessions.send', params: {
          key: session.sessionKey, expectedSessionId: session.generation, workspaceId: session.workspaceId, workspaceDir: session.rootPath,
          message: `${marker} ${goal}`, idempotencyKey: marker,
        } });
        const terminal = await hostInvoke<{ status: string; text?: string }>(app, 'gateway', 'rpc',
          { method: 'agent.wait', params: { runId: response.runId, timeoutMs: 65_000 }, timeoutMs: 70_000 });
        runs[marker] = { runId: response.runId, ...terminal,
          repeatedReads: provider.log.slice(start).filter(entry => entry.issued === 'baseline-read').length };
        expect(terminal.status).toBe('ok');
        return { ...runs[marker], requests: provider.log.slice(start) };
      };
      const baseline = await run('MATERIAL-DIRECT', publisher);
      const candidate = await run('MATERIAL-REUSE', consumer);
      expect(baseline.requests.at(-1)?.issued).toBe(`text:${result}`);
      expect(candidate.requests.at(-1)?.issued).toBe(`text:${result}`);
      expect(baseline.repeatedReads).toBe(1);
      expect(candidate.repeatedReads).toBe(0);
      observations = store.traceSnapshot(claim.taskNodeId).events.filter(event => event.kind === 'material_observation')
        .map(event => event.payload as TaskMaterialObservation);
      expect(observations.map(item => item.phase)).toEqual(expect.arrayContaining(['candidate', 'referenced', 'prompt-used', 'outcome']));
      expect(observations.every(item => item.ref.contentDigest === fixture.contentDigest && item.run?.runId === candidate.runId)).toBe(true);

      store.revokeSharedMaterial(sourceClaim, materialReference(fixture), 'Fixture source no longer applies', 'agent-driven-revocation', () => publisher.scope);
      const revoked = await run('MATERIAL-REVOKED', consumer);
      expect(revoked.requests.at(-1)?.issued).toBe('text:Source withdrawn');
      expect(revoked.requests.every(entry => !Object.values(entry.toolResults).some(text => text.includes(materialText)))).toBe(true);
      const after = store.traceSnapshot(claim.taskNodeId).events.filter(event => event.kind === 'material_observation');
      expect(after.map(event => event.payload)).toEqual(observations);
    } finally { store.close(); }
  } finally {
    await info.attach('material-reuse-pair', { contentType: 'application/json',
      body: JSON.stringify({ driven_by: 'agent', actor: 'scripted-openai-fixture', artifactSha256: sha256, runs, presentations, observations, provider: provider.log }) });
    await closeElectronApp(app);
    await provider.close();
  }
});
