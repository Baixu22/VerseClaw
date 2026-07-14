import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const sourceRoot = 'C:\\agency-agents-main';
const draft = {
  id: 'agency:engineering:code-reviewer',
  status: 'draft',
  sourceDivision: 'engineering',
  sourceAgentName: 'Code Reviewer',
  roleName: 'code-reviewer',
  displayName: 'Code Reviewer',
  description: 'Reviews code with bounded evidence.',
  capabilityHints: ['review'],
  toolHints: ['read', 'shell'],
  handoffHints: [],
  sourceRef: {
    relativePath: 'engineering/code-reviewer.md',
    sha256: 'a'.repeat(64),
  },
  roleCandidate: {
    name: 'code-reviewer',
    displayName: 'Code Reviewer',
    description: 'Reviews code with bounded evidence.',
    rolePrompt: 'Review code and report findings.',
    tools: [],
    effort: 'medium',
    permissions: {
      filesystem: 'read',
      network: 'none',
      commands: [],
    },
    tags: ['agency-draft'],
    outputFormat: 'markdown',
    outputSections: ['Summary', 'Evidence'],
    handoffTo: [],
    handoffFrom: [],
    requiresReview: true,
    riskProfile: 'medium',
  },
  validationIssues: [],
  toolMappingSuggestions: [
    { hint: 'read', candidateTools: ['read'] },
    { hint: 'shell', candidateTools: ['bash'] },
  ],
};

const reviewedRecord = {
  id: 'agency-review-e2e',
  draftId: draft.id,
  sourceRef: draft.sourceRef,
  lifecycle: 'reviewed',
  evidenceQualification: 'scenario-verified',
  evidenceRefs: ['runbook://startup-mvp/evidence'],
  reviewer: 'operator',
  reviewedAt: '2026-07-12T10:00:00.000Z',
  comment: 'Ready for scenario verification.',
  candidate: {
    ...draft.roleCandidate,
    name: 'agency-code-reviewer',
    tools: ['read'],
  },
  toolHintDispositions: [
    {
      hint: 'read',
      disposition: 'mapped',
      selectedTools: ['read'],
      reviewerNote: '',
    },
    {
      hint: 'shell',
      disposition: 'waived',
      selectedTools: [],
      reviewerNote: 'No shell access in this release.',
    },
  ],
  contractSha256: 'b'.repeat(64),
  materialization: { status: 'not-started' },
};

test.describe('Agency role promotion', () => {
  test('reviews, approves, refreshes, and retires a separate config role', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['roles.list', null])]: {
            roles: [{
              name: 'planner',
              displayName: 'Planner',
              rolePrompt: 'Plan work.',
              tools: ['read'],
              effort: 'medium',
              origin: 'built-in',
            }],
          },
        },
        hostApi: {
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
              modelDisplay: 'gpt-5',
              modelRef: 'openai/gpt-5',
              overrideModelRef: null,
              inheritedModel: true,
              workspace: 'C:\\project',
              agentDir: 'C:\\openclaw\\agents\\main\\agent',
              mainSessionKey: 'agent:main:main',
              channelTypes: [],
            }],
          },
          [stableStringify(['channels', 'accounts', null])]: { success: true, channels: [] },
          [stableStringify(['providers', 'snapshot', null])]: {
            success: true,
            accounts: [],
            statuses: [],
            vendors: [],
            defaultAccountId: '',
          },
          [stableStringify(['dialog', 'open', null])]: {
            canceled: false,
            filePaths: [sourceRoot],
          },
          [stableStringify(['roles', 'agencyCatalog', null])]: {
            success: true,
            drafts: [draft],
            reviews: [],
          },
          [stableStringify(['roles', 'previewAgencyPromotion', null])]: {
            success: true,
            persisted: false,
            validation: { ok: true, issues: [] },
            contractSha256: 'b'.repeat(64),
            role: { ...draft.roleCandidate, origin: 'config' },
          },
          [stableStringify(['roles', 'reviewAgencyPromotion', null])]: {
            success: true,
            record: reviewedRecord,
            pendingRuntimeRefresh: false,
          },
          [stableStringify(['roles', 'approveAgencyPromotion', null])]: {
            success: true,
            record: {
              ...reviewedRecord,
              lifecycle: 'active',
              decision: 'approved',
              decidedBy: 'operator',
              decidedAt: '2026-07-12T10:05:00.000Z',
              materializedRoleName: 'agency-code-reviewer',
              materialization: { status: 'complete' },
            },
            pendingRuntimeRefresh: true,
          },
          [stableStringify(['roles', 'retireAgencyPromotion', null])]: {
            success: true,
            record: {
              ...reviewedRecord,
              lifecycle: 'retired',
              decision: 'retired',
              decidedBy: 'operator',
              decidedAt: '2026-07-12T10:10:00.000Z',
              materializedRoleName: 'agency-code-reviewer',
              materialization: { status: 'complete' },
            },
            pendingRuntimeRefresh: true,
          },
        },
      });

      const page = await getStableWindow(app);
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();
      await page.getByTestId('role-orchestration-toggle').click();

      await page.getByTestId('agency-source-select').click();
      await expect(page.getByTestId('agency-source-path')).toContainText(sourceRoot);
      await page.getByText('Code Reviewer').click();
      await expect(page.getByTestId('agency-draft-status')).toContainText('Draft');

      await page.getByTestId('agency-hint-read-map').click();
      await page.getByTestId('agency-hint-read-tools').fill('read');
      await page.getByTestId('agency-hint-shell-waive').click();
      await page.getByTestId('agency-hint-shell-note').fill('No shell access in this release.');
      await page.getByTestId('agency-evidence-qualification').selectOption('scenario-verified');
      await page.getByTestId('agency-evidence-refs').fill('runbook://startup-mvp/evidence');
      await page.getByLabel('Review comment').fill('Ready for scenario verification.');
      await page.getByTestId('agency-promotion-review').click();

      await expect(page.getByTestId('agency-promotion-lifecycle')).toContainText('Reviewed');
      await expect(page.getByTestId('agency-draft-status')).toContainText('Draft');
      await page.getByTestId('agency-promotion-approve').click();
      await page.getByTestId('confirm-dialog-confirm-button').click();
      await expect(page.getByTestId('agency-promotion-lifecycle')).toContainText('Active');
      await expect(page.getByText(/Saved to config/)).toBeVisible();

      const calls = await app.evaluate(() => (
        (globalThis as unknown as {
          __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }>;
        }).__verseClawE2eHostCalls ?? []
      ));
      const roleCalls = calls.filter((call) => call.module === 'roles');
      expect(roleCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          module: 'roles',
          action: 'reviewAgencyPromotion',
          payload: expect.objectContaining({
            sourceRoot,
            draftId: draft.id,
            evidenceQualification: 'scenario-verified',
            evidenceRefs: ['runbook://startup-mvp/evidence'],
            toolHintDispositions: [
              expect.objectContaining({
                hint: 'read',
                disposition: 'mapped',
                selectedTools: ['read'],
              }),
              expect.objectContaining({
                hint: 'shell',
                disposition: 'waived',
                reviewerNote: 'No shell access in this release.',
              }),
            ],
          }),
        }),
        expect.objectContaining({
          module: 'roles',
          action: 'approveAgencyPromotion',
          payload: {
            reviewId: 'agency-review-e2e',
            reviewer: 'operator',
            comment: 'Ready for scenario verification.',
          },
        }),
      ]));

      await page.getByTestId('agency-promotion-retire').click();
      await page.getByTestId('confirm-dialog-confirm-button').click();
      await expect(page.getByTestId('agency-promotion-lifecycle')).toContainText('Retired');
      await expect(page.getByTestId('agency-draft-status')).toContainText('Draft');
    } finally {
      await closeElectronApp(app);
    }
  });
});
