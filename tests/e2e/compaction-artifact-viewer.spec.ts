import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Compaction artifact viewer', () => {
  test('opens compression evidence and prepares recovery context without lossless wording', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { language: 'en', setupComplete: true } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main' }] } },
          },
          [stableStringify(['/api/chat/sessions', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] } },
            },
          },
          [stableStringify(['/api/chat/history', 'POST'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, result: { messages: [] } } },
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [],
            activeWorkspaceId: null,
            activeWorkspace: null,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            profiles: [],
            activeWorkspaceId: null,
            activeWorkspace: null,
          },
          [stableStringify(['usage', 'contextRange', {
            messageCount: 0,
            modelRef: null,
            sessionKey: SESSION_KEY,
            usedTokens: null,
          }])]: {
            success: true,
            range: {
              sessionKey: SESSION_KEY,
              usedTokens: 96000,
              maxTokens: 128000,
              truncatedMessageCount: 2,
              status: 'bestEffort',
            },
          },
          [stableStringify(['usage', 'live', {
            runId: null,
            sessionKey: SESSION_KEY,
            streaming: false,
          }])]: { success: true, usage: null },
          [stableStringify(['sessions', 'compactionStatus', {
            agentId: 'main',
            sessionKey: SESSION_KEY,
          }])]: {
            success: true,
            available: true,
            canCompact: true,
            inProgress: false,
            pressure: 'high',
            usedTokens: 96000,
            maxTokens: 128000,
            remainingTokens: 32000,
            truncatedMessageCount: 2,
            warnings: ['review current state before continuing'],
            lastCompaction: {
              checkpointId: 'checkpoint-42',
              quality: {
                score: 0.91,
                evidenceCoverage: 0.8,
                fieldCoverage: 0.86,
                projectionTokens: 1440,
                level: 'high',
              },
              unverifiedCount: 1,
              reviewNeededCount: 1,
            },
          },
          [stableStringify(['sessions', 'compressionArtifact', {
            agentId: 'main',
            sessionKey: SESSION_KEY,
          }])]: {
            success: true,
            checkpointId: 'checkpoint-42',
            artifact: {
              version: 1,
              objective: 'Finish P2 productization evidence.',
              currentState: 'Roles and compaction viewer are wired through host-api.',
              done: [{
                text: 'Host API facade exposes compressionArtifact.',
                evidenceRefs: [{ type: 'file', ref: 'src/lib/host-api.ts', label: 'host-api facade' }],
              }],
              inProgress: [],
              blocked: [],
              decisions: [],
              filesTouched: [],
              testsRun: [],
              failedAttempts: [],
              deviations: [],
              reviewNeeded: [{
                text: 'Review runtime refresh after role config save.',
                evidenceRefs: [{ type: 'test', ref: 'role-management.spec.ts' }],
              }],
              unverifiedClaims: ['Runtime may need a refresh before the new role appears.'],
              warnings: ['Manual recovery context only.'],
              quality: {
                score: 0.91,
                evidenceCoverage: 0.8,
                fieldCoverage: 0.86,
                projectionTokens: 1440,
                warnings: ['one claim remains unverified'],
              },
            },
            warnings: [],
          },
          [stableStringify(['sessions', 'prepareHandoff', {
            agentId: 'main',
            sessionKey: SESSION_KEY,
            workspaceId: null,
          }])]: {
            success: true,
            draft: 'Continue from checkpoint-42 with reviewed context.',
            evidence: { recoveryContext: true },
          },
        },
      });

      const page = await getStableWindow(app);
      // Shared root cause: the composer compact icon was removed (see
      // tests/unit/chat-input.test.tsx). Gate readiness on the composer input.
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-compaction-view-artifact')).toHaveCount(0);

      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-general').click();
      await expect(page.getByTestId('settings-ui-depth-mode')).toBeVisible();
      await page.getByTestId('settings-ui-depth-advanced').click();
      await page.evaluate(() => {
        window.location.hash = '#/';
      });

      await expect(page.getByTestId('chat-compaction-view-artifact')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-compaction-view-artifact').click();

      const viewer = page.getByTestId('chat-compaction-artifact-viewer');
      await expect(viewer).toBeVisible();
      await expect(viewer).toContainText('Finish P2 productization evidence.');
      await expect(viewer).toContainText('host-api facade');
      await expect(viewer).toContainText('Runtime may need a refresh');
      await expect(viewer).not.toContainText(/lossless|无损/i);
      await expect(viewer.getByRole('button', { name: /Fork\/branch session/i })).toBeVisible();

      await viewer.getByRole('button', { name: /Prepare recovery context/i }).click();
      await expect(page.getByTestId('chat-handoff-dialog')).toBeVisible();
      await expect(page.getByText('Continue from checkpoint-42 with reviewed context.')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
