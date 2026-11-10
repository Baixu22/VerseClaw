import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from '../e2e/fixtures/electron';
import { hostInvoke, startScriptedLlm } from '../e2e/fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject } from '../e2e/fixtures/session-task-chain';
import { assertFreshProductBuildProof, readProductCandidate } from '../e2e/fixtures/product-candidate';

const states = ['chat', 'settings-general', 'settings-models', 'settings-agents', 'settings-skills',
  'settings-channels', 'knowledge', 'memory', 'task-ledger', 'cron'];

test('TF-0582 agent explores the isolated built application for at least twenty minutes', async ({ launchElectronApp }, testInfo) => {
  const candidate = readProductCandidate();
  assert(process.env.CLAWX_SPACE_BUNNY_BUILD_PROOF, 'Exploration requires the sealed current build');
  assertFreshProductBuildProof(JSON.parse(await readFile(process.env.CLAWX_SPACE_BUNNY_BUILD_PROOF, 'utf8')), candidate);
  const runId = randomUUID();
  const consoleEntries: Array<{ at: string; type: string; text: string }> = [];
  const pageErrors: string[] = [];
  const llm = await startScriptedLlm(userText => ({ text: `Observed ${userText.match(/EXPLORE_[A-Z0-9_]+/g)?.at(-1) ?? 'ready'}` }));
  let app: ElectronApplication | undefined;
  let cleanupError: unknown;
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'product-matrix-exploration', runId,
    candidate: { commit: candidate.commit, tree: candidate.tree, dirty: candidate.dirty, inputDigest: candidate.inputDigest },
    requiredStates: states, status: 'running' };
  try {
    app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'light' });
    const port = Number(await app.evaluate(() => process.env.VERSE_CLAW_REMOTE_DEBUGGING_PORT));
    assert(Number.isInteger(port) && port > 0, 'Isolated Electron CDP port is missing');
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, testInfo.outputPath('workspace'), 'Matrix exploration');
    const page = await getStableWindow(app);
    page.on('console', message => consoleEntries.push({ at: new Date().toISOString(), type: message.type(), text: message.text() }));
    page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
    await page.reload();
    await expect(page.getByTestId('main-layout')).toBeVisible();
    const readyAt = Date.now();
    await writeFile(testInfo.outputPath('session.json'), JSON.stringify({ runId, readyAt, cdpUrl: `http://127.0.0.1:${port}`,
      outputDir: testInfo.outputDir, project, requiredStates: states, minimumDurationMs: 20 * 60_000 }, null, 2) + '\n');
    let completion: { runId: string; startedAt: number; finishedAt: number; visitedStates: string[];
      actions: unknown[]; observations: Array<{ priority: string; status: string }> } | undefined;
    await expect.poll(async () => {
      try { completion = JSON.parse(await readFile(testInfo.outputPath('agent-review.json'), 'utf8')); return completion?.runId === runId; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    }, { timeout: 32 * 60_000, intervals: [1000] }).toBe(true);
    assert(completion);
    evidence.review = completion;
    expect(completion.startedAt).toBeGreaterThanOrEqual(readyAt);
    expect(completion.finishedAt).toBeLessThanOrEqual(Date.now());
    expect(completion.finishedAt - completion.startedAt).toBeGreaterThanOrEqual(20 * 60_000);
    expect(completion.actions.length).toBeGreaterThanOrEqual(25);
    for (const state of states) expect(completion.visitedStates).toContain(state);
    expect(completion.observations.filter(row => ['P0', 'P1'].includes(row.priority) && row.status !== 'resolved')).toEqual([]);
    expect(pageErrors).toEqual([]);
    const after = readProductCandidate();
    expect(after.commit).toBe(candidate.commit);
    expect(after.tree).toBe(candidate.tree);
    expect(after.dirty).toBe(false);
    expect(after.inputDigest).toBe(candidate.inputDigest);
    await page.screenshot({ path: testInfo.outputPath('final-state.png') });
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed'; evidence.error = String(error); throw error;
  } finally {
    try {
      if (app) {
        try { await hostInvoke(app, 'gateway', 'stop'); }
        finally { await closeElectronApp(app); }
      }
    } catch (error) {
      cleanupError = error; evidence.status = 'failed'; evidence.cleanupError = String(error);
    } finally {
      llm.server.closeAllConnections();
      await new Promise<void>(resolve => llm.server.close(() => resolve()));
      evidence.console = consoleEntries; evidence.pageErrors = pageErrors; evidence.providerLog = llm.log;
      await writeFile(testInfo.outputPath('exploration-result.json'), JSON.stringify(evidence, null, 2) + '\n');
    }
  }
  if (cleanupError) throw cleanupError;
});
