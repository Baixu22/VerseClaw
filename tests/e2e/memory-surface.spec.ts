// TF-0498: one Memory surface must expose candidate review, export and
// tombstone deletion without a second Memory management route.
import { join } from 'node:path';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const role = {
  name: 'architect',
  displayName: 'Architect',
  description: 'Designs the system shape.',
  rolePrompt: 'Designs the system shape.',
  tools: ['read'],
  effort: 'high',
};

const acceptedCard = {
  id: 'mem-accepted',
  type: 'procedure',
  scope: 'role',
  scopeKey: null,
  status: 'active',
  content: 'Keep migration notes before schema changes.',
  roleTags: ['architect'],
  source: 'user',
  sensitivity: 'normal',
  confidence: 0.9,
  importance: 0.7,
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
  evidenceRefs: [{ type: 'manual', ref: 'acceptance-fixture' }],
};

const reviewProposal = {
  id: 'proposal-candidate',
  operation: 'create',
  status: 'needs_review',
  decision: 'needs_review',
  riskLevel: 'low',
  impactScope: 'role',
  suggestedAction: 'approve',
  evidenceStatus: 'unchecked',
  createdAt: '2026-10-21T00:00:00.000Z',
  proposal: {
    content: 'Candidate memory must be reviewed before injection.',
    source: 'session_summary',
    title: 'Candidate memory',
  },
};

const runtimeCandidate = {
  factId: 'fact-1',
  subject: 'user',
  predicate: 'prefers',
  objectSummary: 'dark mode',
  confidence: 0.82,
  source: 'runtime-memory',
  proposedAt: 1_726_000_000_000,
};

const baseHostApi: Record<string, unknown> = {
  [stableStringify(['/api/settings', 'GET'])]: {
    ok: true,
    data: { status: 200, ok: true, json: { language: 'en', setupComplete: true } },
  },
  [stableStringify(['agents', 'list', null])]: {
    success: true,
    defaultAgentId: 'main',
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
    agents: [{
      id: 'main',
      name: 'Main',
      isDefault: true,
      modelDisplay: 'test/model',
      modelRef: 'test/model',
      inheritedModel: false,
      workspace: 'C:\\project',
      agentDir: 'C:\\openclaw\\agents\\main\\agent',
      mainSessionKey: 'agent:main:main',
      channelTypes: [],
    }],
  },
  [stableStringify(['channels', 'accounts', null])]: { success: true, channels: [] },
  [stableStringify(['providers', 'snapshot', null])]: {
    success: true, accounts: [], statuses: [], vendors: [], defaultAccountId: '',
  },
  [stableStringify(['memory', 'list', null])]: {
    success: true,
    cards: [acceptedCard],
  },
  [stableStringify(['memory', 'explainInjection', null])]: {
    success: true,
    injections: [],
  },
  [stableStringify(['memory', 'health', null])]: {
    success: true,
    ok: true,
    checks: [],
  },
  [stableStringify(['memory', 'proposeFactsList', null])]: {
    success: true,
    enabled: true,
    candidates: [runtimeCandidate],
  },
  [stableStringify(['memory', 'proposeFactsConfirm', null])]: {
    success: true,
    confirmed: true,
    message: 'confirmed',
    factId: 'fact-1',
  },
};

const gatewayRpc: Record<string, unknown> = {
  [stableStringify(['roles.list', null])]: { roles: [role] },
  [stableStringify(['memory.proposals', null])]: { proposals: [reviewProposal] },
  [stableStringify(['memory.conflicts', null])]: { conflicts: [] },
  [stableStringify(['memory.stats', null])]: {
    stats: {
      active: 1,
      cold: 0,
      archived: 0,
      tombstone: 0,
      conflictsOpen: 0,
      proposalsNeedsReview: 1,
      proposalsRejected: 0,
      proposalsApplied: 0,
    },
  },
  [stableStringify(['memory.retentionCandidates', null])]: { candidates: [] },
  [stableStringify(['memory.utilityReport', null])]: {
    report: {
      generatedAt: '2026-10-21T00:00:00.000Z',
      dataQuality: 'insufficient',
      missingEvidence: [],
      sample: { cards: 1, injections: 0, feedback: 0, proposals: 1, conflicts: 0 },
      aggregate: {
        contextPrecisionAtK: null,
        helpfulnessRate: null,
        harmRate: null,
        staleRate: null,
        conflictRate: null,
        reviewAcceptanceRate: null,
        tokenOverheadPerRun: null,
        taskSuccessDelta: null,
      },
      cards: [],
    },
  },
  [stableStringify(['memory.archive', null])]: {
    card: { ...acceptedCard, status: 'tombstone' },
  },
};

async function openMemorySurface(app: Parameters<typeof getStableWindow>[0]) {
  const page = await getStableWindow(app);
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await page.getByTestId('sidebar-nav-settings').click();
  await page.getByTestId('settings-nav-agents').click();
  await expect(page.getByTestId('agents-page')).toBeVisible();
  await page.getByTestId('role-orchestration-toggle').click();
  await page.getByRole('button', { name: /Architect/ }).click();
  await expect(page.getByTestId('role-memory-panel')).toBeVisible();
  return page;
}

test.describe('TF-0498 unified Memory surface', () => {
  test('exposes candidate review, export and tombstone deletion in one panel', async ({ launchElectronApp, userDataDir }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, env: { TEMP: userDataDir, TMP: userDataDir } });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc,
        hostApi: baseHostApi,
      });
      const page = await openMemorySurface(app);

      const panel = page.getByTestId('role-memory-panel');
      await expect(panel).toHaveAttribute('data-surface-id', 'agents.memory');
      await expect(page.getByTestId('memory-runtime-candidates')).toBeVisible();
      await expect(page.getByTestId('propose-facts-confirm-queue')).toBeVisible();
      await expect(page.getByTestId('propose-facts-candidate')).toHaveAttribute('data-fact-id', 'fact-1');
      await expect(page.getByTestId('memory-model-visibility')).toContainText(/review-only/i);
      await expect(page.getByTestId('memory-surface-semantics')).toContainText('Read: accepted only');
      await expect(page.getByTestId('memory-surface-semantics')).toContainText('Delete: tombstone');
      await expect(page.getByTestId('memory-surface-semantics')).toContainText('Legacy: native unchanged');

      const downloadDir = join(userDataDir, 'memory-export');
      await mkdir(downloadDir, { recursive: true });
      await app.evaluate(({ session }, targetDir: string) => {
        const downloads = globalThis as unknown as { __tf0498Downloads: Array<{ filename: string; state: string; receivedBytes: number }> };
        downloads.__tf0498Downloads = [];
        session.defaultSession.setDownloadPath(targetDir);
        session.defaultSession.on('will-download', (_event, item) => {
          const observed = { filename: item.getFilename(), state: item.getState(), receivedBytes: 0 };
          downloads.__tf0498Downloads.push(observed);
          item.once('done', (_doneEvent, state) => { observed.state = state; observed.receivedBytes = item.getReceivedBytes(); });
          item.setSavePath(process.getBuiltinModule('node:path')!.join(targetDir, item.getFilename()));
        });
      }, downloadDir);
      await page.getByTestId('memory-export').click();
      await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __tf0498Downloads: Array<{state: string}> }).__tf0498Downloads.map((item) => item.state)), { timeout: 30_000 }).toEqual(['completed']);
      await expect.poll(async () => {
        try {
          return (await readdir(downloadDir)).filter((name) => name.startsWith('clawx-memory-architect-'));
        } catch {
          return [];
        }
      }, { timeout: 30_000 }).toHaveLength(1);
      const [downloadName] = (await readdir(downloadDir)).filter((name) => name.startsWith('clawx-memory-architect-'));
      expect(downloadName).toMatch(/^clawx-memory-architect-/);
      const content = await readFile(join(downloadDir, downloadName!), 'utf8');
      await testInfo.attach('memory-export.json', { body: Buffer.from(content), contentType: 'application/json' });
      await rm(downloadDir, { recursive: true, force: true });
      const exported = JSON.parse(content) as {
        schemaVersion: string;
        counts: { accepted: number; candidates: number };
        acceptedMemory: Array<{ id: string }>;
        candidateQueue: Array<{ id: string }>;
      };
      expect(exported.schemaVersion).toBe('MemoryExport/v1');
      expect(exported.counts.accepted).toBe(1);
      expect(exported.counts.candidates).toBe(1);
      expect(exported.acceptedMemory.map((card) => card.id)).toEqual(['mem-accepted']);
      expect(exported.candidateQueue.map((proposal) => proposal.id)).toEqual(['proposal-candidate']);

      await page.getByTestId('role-memory-delete').click();
      await page.getByTestId('confirm-dialog-confirm-button').click();
      const calls = await app.evaluate(() => {
        return (globalThis as unknown as { __verseClawE2eHostCalls?: unknown[] }).__verseClawE2eHostCalls ?? [];
      });
      expect(calls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          module: 'gateway',
          action: 'rpc',
          payload: expect.objectContaining({ method: 'memory.archive', params: { id: 'mem-accepted', tombstone: true } }),
        }),
      ]));
    } finally {
      const downloads = await app.evaluate(() => (globalThis as unknown as { __tf0498Downloads?: unknown[] }).__tf0498Downloads ?? []).catch(() => []);
      await testInfo.attach('memory-download.json', { body: Buffer.from(JSON.stringify({ actor: 'playwright-memory-surface', driven_by: 'agent', downloads }, null, 2)), contentType: 'application/json' });
      await closeElectronApp(app);
    }
  });
});
