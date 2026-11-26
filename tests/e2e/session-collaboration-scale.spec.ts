import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { closeElectronApp, expect, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { collaborationFixtureStorePath, createCollaborationChild, createCollaborationProject, enableCollaborationFixtureVisibility } from './fixtures/session-collaboration';
import { loadExistingSqliteSessionStoreReadOnly, replaceSqliteSessionStore } from '../../openclaw_runtime/src/config/sessions/store-sqlite';
import { parseSessionCollaborationQuery, type SessionCollaborationPage } from '../../shared/types/session-collaboration';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const percentile = (samples: number[], ratio: number) => samples.length ? [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * ratio) - 1] : null;
test('records original owner reads and bounded synthetic scale without measured-value placeholders', async ({ launchElectronApp }, info) => {
  test.setTimeout(360_000);
  const provider = await startScriptedLlm(() => ({ text: 'Fixture scope established.' }));
  const app = await launchElectronApp({ skipSetup: true });
  const records: unknown[] = [];
  let failure: string | null = null;
  let storePath: string | undefined, original: ReturnType<typeof loadExistingSqliteSessionStoreReadOnly> | undefined;
  try {
    await configureSessionChainProvider(app, provider.port);
    const alpha = await createCollaborationProject(app, info.outputPath('alpha'), 'Alpha scale');
    const beta = await createCollaborationProject(app, info.outputPath('beta'), 'Beta scale');
    const child = await createCollaborationChild(app, alpha);
    const taskState = () => [alpha, beta, child].map(project => {
      const store = new TaskSystemStore(resolveTaskDomain(project.rootPath), undefined, undefined, true);
      try { return store.sessionSnapshot(project.sessionKey, project.generation); } finally { store.close(); }
    });
    await enableCollaborationFixtureVisibility(app);
    storePath = await collaborationFixtureStorePath(app); original = loadExistingSqliteSessionStoreReadOnly(storePath);
    expect(original[alpha.sessionKey].workspaceId).toBe(alpha.workspaceId); expect(original[beta.sessionKey].workspaceId).toBe(beta.workspaceId);
    const childRead = await hostInvoke<{ page: SessionCollaborationPage }>(app, 'sessionActivity', 'query', parseSessionCollaborationQuery({ requester: alpha.scope, target: child.scope, limit: 1 }));
    expect(childRead.page.items[0].sources.tasks.value?.[0].referenceOnly).toBe(true);
    for (const count of [2, 20, 100, 500]) {
      const entries = { [alpha.sessionKey]: original[alpha.sessionKey], [beta.sessionKey]: original[beta.sessionKey] };
      if (count > 2) entries[child.sessionKey] = original[child.sessionKey];
      for (let index = count === 2 ? 2 : 3; index < count; index++) entries[`agent:main:synthetic-${index}`] = {
        sessionId: randomUUID(), workspaceId: alpha.workspaceId, workspaceDir: alpha.rootPath,
        updatedAt: 1, label: `Synthetic session ${index}`, parentSessionKey: alpha.sessionKey,
      };
      replaceSqliteSessionStore(storePath, entries);
      const before = loadExistingSqliteSessionStoreReadOnly(storePath), modelCalls = provider.log.length;
      expect(Object.keys(before)).toHaveLength(count);
      const tasksBefore = taskState();
      const samples: number[] = [], scans: number[] = [], detailSamples: number[] = [], detailScans: number[] = [], mainRss: number[] = [];
      const record = { count, source: count === 2 ? 'original Workspace/Session owners' : 'agent-driven synthetic SessionStore metadata',
        sourceCandidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), state: 'collecting', samples, scans, detailSamples, detailScans, mainRss,
        list: { p50Ms: null as number | null, p95Ms: null as number | null }, detail: { p50Ms: null as number | null, p95Ms: null as number | null },
        rss: { scope: 'electron-main', peakSampledBytes: null as number | null, sampling: 'Main process.memoryUsage after each listed query' },
        beforeSha256: digest(before), afterSha256: null as string | null, taskBeforeSha256: digest(tasksBefore), taskAfterSha256: null as string | null,
        modelCallsBefore: modelCalls, modelCallsAfter: null as number | null };
      records.push(record);
      for (let sample = 0; sample < 20; sample++) {
        const query = parseSessionCollaborationQuery({ requester: alpha.scope, limit: 50 });
        const start = performance.now();
        const result = await hostInvoke<{ page: SessionCollaborationPage }>(app, 'sessionActivity', 'query', query);
        samples.push(performance.now() - start); scans.push(result.page.scanned);
        mainRss.push(await app.evaluate(() => process.memoryUsage().rss));
        expect(result.page.state).toBe('ready');
        expect(result.page.items.some(item => item.sessionKey === alpha.sessionKey)).toBe(true);
        expect(result.page.scanned).toBeLessThanOrEqual(100); expect(result.page.items.length).toBeLessThanOrEqual(50);
        const detailStart = performance.now();
        const detail = await hostInvoke<{ page: SessionCollaborationPage }>(app, 'sessionActivity', 'query',
          parseSessionCollaborationQuery({ requester: alpha.scope, target: beta.scope, limit: 1 }));
        detailSamples.push(performance.now() - detailStart);
        detailScans.push(detail.page.scanned);
        expect(detail.page.state).toBe('ready');
        expect(detail.page.items[0]?.detail?.scope).toEqual(beta.scope);
      }
      const after = loadExistingSqliteSessionStoreReadOnly(storePath);
      record.list = { p50Ms: percentile(samples, .5), p95Ms: percentile(samples, .95) }; record.detail = { p50Ms: percentile(detailSamples, .5), p95Ms: percentile(detailSamples, .95) };
      record.rss.peakSampledBytes = mainRss.length ? Math.max(...mainRss) : null;
      record.afterSha256 = digest(after); record.taskAfterSha256 = digest(taskState()); record.modelCallsAfter = provider.log.length;
      expect(after).toEqual(before); expect(record.taskAfterSha256).toBe(record.taskBeforeSha256); expect(provider.log.length).toBe(modelCalls);
      record.state = 'measured';
    }
  } catch (error) { failure = String(error); throw error;
  } finally {
    if (storePath && original) replaceSqliteSessionStore(storePath, original);
    await writeFile(info.outputPath('scale-raw-samples.json'), JSON.stringify({ driven_by: 'agent', actor: 'session-collaboration-scale',
      decision: 'measurement-only; thresholds require a completed run and source readback', failure, records }, null, 2));
    await closeElectronApp(app); await provider.close();
  }
});
