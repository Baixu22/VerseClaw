import {
  expect,
  getAgentDevHostCalls,
  installIpcMocks,
  openAgentDevScenario,
  test,
} from './fixtures/electron';

const sha = `sha256:${'a'.repeat(64)}`;

const status = {
  schema: 'openclaw.local-control-plane.status.v1',
  mode: 'observe',
  legacyUnaffected: true,
  flags: {
    contextReport: true,
    modelRouterReport: false,
    capabilityReport: false,
    evidenceReport: true,
    missionReport: false,
  },
  enabledKinds: ['context', 'evidence'],
  buffer: { size: 2, maxSize: 200, lastReportAt: '2026-08-18T10:00:00.000Z' },
  countsByKind: { context: 1, model_router: 0, capability: 0, evidence: 1, mission: 0 },
};

const reports = [
  {
    schema: 'openclaw.local-control-plane.report.v1',
    id: 'lcp_context_stage6',
    kind: 'context',
    mode: 'observe',
    legacyUnaffected: true,
    timestamp: '2026-08-18T10:00:00.000Z',
    summary: 'LoopContextPack 20/100 tokens; p0Preserved=true',
    diagnostics: [],
    evidenceRefs: [{ type: 'task', ref: 'task:stage6' }],
    payload: {
      sections: [
        { id: 'stable', itemCount: 2, omittedItemCount: 0, protectedItemCount: 2 },
        { id: 'dynamic', itemCount: 4, omittedItemCount: 1, protectedItemCount: 0 },
      ],
    },
  },
  {
    schema: 'openclaw.local-control-plane.report.v1',
    id: 'lcp_evidence_stage6',
    kind: 'evidence',
    mode: 'observe',
    legacyUnaffected: true,
    timestamp: '2026-08-18T10:00:01.000Z',
    summary: 'Evidence gate pass',
    diagnostics: [],
    evidenceRefs: [{ type: 'journal', ref: `journal:${sha}` }],
    payload: { coverage: { evidenceRefCount: 1 } },
  },
];

const correlations = {
  schema: 'openclaw.local-control-plane.correlations.v1',
  mode: 'observe',
  legacyUnaffected: true,
  generatedAt: '2026-08-18T10:00:02.000Z',
  filter: { groupBy: 'evidence' },
  totals: { reportCount: 2, groupCount: 1, evidenceRefCount: 2 },
  groups: [{
    key: 'task:stage6',
    groupBy: 'evidence',
    evidenceRefs: [{ type: 'task', ref: 'task:stage6' }],
    reportIds: ['lcp_context_stage6', 'lcp_evidence_stage6'],
    kinds: ['context', 'evidence'],
    reportCount: 2,
    firstReportAt: '2026-08-18T10:00:00.000Z',
    lastReportAt: '2026-08-18T10:00:01.000Z',
    diagnosticsBySeverity: { info: 0, warning: 0, error: 0 },
    diagnosticCodes: [],
  }],
};

test.describe('context control plane stage 6 panel', () => {
  test('renders read-only diff/why/simulation/replay through host-api', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      hostApi: {
        '["localControlPlane","status",null]': { success: true, status },
        '["localControlPlane","reports",{"kind":"context","limit":50}]': { success: true, reports: [reports[0]] },
        '["localControlPlane","reports",{"kind":"evidence","limit":50}]': { success: true, reports: [reports[1]] },
        '["localControlPlane","correlations",{"groupBy":"evidence"}]': { success: true, correlations },
      },
    });

    await openAgentDevScenario(page, 'chat-empty', { visualMode: true });
    const settingsUrl = new URL(page.url());
    settingsUrl.searchParams.delete('devScenario');
    settingsUrl.hash = '/settings/developer';
    await page.goto(settingsUrl.toString());
    await expect(page.getByTestId('settings-developer-section')).toBeVisible();

    const panel = page.getByTestId('settings-context-control-plane-panel');
    if (await panel.count() === 0) {
      await page.getByTestId('settings-dev-mode-switch').click();
    }

    await expect(panel).toBeVisible();
    await expect(page.getByTestId('settings-ccp-reports')).toContainText('2');
    await expect(page.getByTestId('settings-ccp-correlations')).toContainText('1');
    await expect(page.getByTestId('settings-ccp-diff')).toBeVisible();
    await expect(page.getByTestId('settings-ccp-diff')).toContainText('Selected');
    await expect(page.getByTestId('settings-ccp-diff')).toContainText('Omitted');
    await expect(page.getByTestId('settings-ccp-diff')).toContainText('Protected section');

    const callsBefore = await getAgentDevHostCalls(page);

    await page.getByTestId('settings-ccp-run-simulation').click();
    await expect(page.getByTestId('settings-ccp-simulation-result')).toBeVisible();
    await expect(page.getByTestId('settings-ccp-simulation-result')).toContainText('dry-run');
    await expect(page.getByTestId('settings-ccp-simulation-result')).toContainText('Allow');
    await expect(page.getByTestId('settings-ccp-simulation-result')).toContainText('Protected rule');
    const callsAfterSimulation = await getAgentDevHostCalls(page);
    expect(callsAfterSimulation.length).toBe(callsBefore.length);

    await page.getByTestId('settings-ccp-build-replay').click();
    await expect(page.getByTestId('settings-ccp-replay-result')).toBeVisible();
    await expect(page.getByTestId('settings-ccp-replay-result')).toContainText('false');
    await expect(page.getByTestId('settings-ccp-replay-result')).toContainText('task:stage6');
  });
});
