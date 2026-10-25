import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, test } from './fixtures/electron';

const repoRoot = process.cwd();
const workspacePath = process.env.VERSEGIT_PROVIDER_ROOT ?? process.cwd();
const sidecarManifest = JSON.parse(readFileSync(join(repoRoot, 'resources/versegit/manifest.json'), 'utf8'));
const binarySha256 = sidecarManifest.artifact.sha256;
const version = sidecarManifest.artifact.version;
const binding = { workspaceId: 'workspace-e2e', sessionId: 'session-e2e', worktreeId: 'worktree-e2e', ownerId: 'agent:codex', epoch: 5, mode: 'M1' };
const env = {
  CLAWX_VERSGIT_DIAGNOSTICS: '1',
  CLAWX_VERSGIT_APP_PATH: repoRoot,
  CLAWX_VERSGIT_PROVIDER_ROOT: workspacePath,
  CLAWX_VERSGIT_REPO_ID: 'repo-e2e',
  CLAWX_VERSGIT_ALLOWED_WORKSPACE_ID: binding.workspaceId,
  CLAWX_VERSGIT_ALLOWED_SESSION_ID: binding.sessionId,
  CLAWX_VERSGIT_ALLOWED_WORKTREE_ID: binding.worktreeId,
  CLAWX_VERSGIT_OWNER_ID: binding.ownerId,
  CLAWX_VERSGIT_EPOCH: String(binding.epoch),
  CLAWX_VERSGIT_AUTHORIZATION_ID: 'grant-e2e',
  CLAWX_VERSGIT_GRANT_EXPIRES_AT: '2099-01-01T00:00:00.000Z',
  CLAWX_VERSGIT_WORKTREE_COUNT: '2',
  CLAWX_VERSGIT_ACTIVE_SESSION_COUNT: '1',
};

async function hostStatus(page: Page, payload: Record<string, unknown>) {
  return page.evaluate(async (requestPayload: Record<string, unknown>) => {
    const bridge = (window as unknown as {
      verseClaw?: { hostInvoke: (request: Record<string, unknown>) => Promise<unknown> };
    }).verseClaw?.hostInvoke;
    if (!bridge) throw new Error('hostInvoke bridge is missing');
    const requestId = `versegit-diagnostics-${crypto.randomUUID()}`;
    return bridge({ id: requestId, module: 'versegit', action: 'status', payload: requestPayload });
  }, payload);
}

test.describe('VerseGit host diagnostics', () => {
  test('returns real frozen identity through renderer -> hostInvoke -> Main service', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, env });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      const response = await hostStatus(page, binding);
      expect(response).toMatchObject({
        ok: true,
        data: {
          enabled: true,
          mode: 'M1',
          status: 'observed',
          hostVerdict: 'unchanged',
          identity: { repoId: 'repo-e2e', binarySha256, version, capabilitiesSchema: 'versegit.capabilities/v1' },
          capabilities: { safety: { default_enable: false }, verdict: { single_green_light: false } },
          observation: { processStarted: true, exitCode: 0 },
        },
      });
      const serialized = JSON.stringify(response);
      expect(serialized).not.toContain(join(repoRoot, sidecarManifest.artifact.devPath));
      expect(serialized).not.toContain('argv');

      const denied = await hostStatus(page, { ...binding, workspaceId: 'workspace-other' });
      expect(denied).toMatchObject({ ok: true, data: { status: 'rejected_by_policy', reason: 'identity_mismatch', observation: null } });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('reports binary mismatch without spawning a process', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, env: { ...env, CLAWX_VERSGIT_EXPECTED_BINARY_SHA256: '0'.repeat(64) } });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      const response = await hostStatus(page, binding);
      expect(response).toMatchObject({ ok: true, data: { status: 'rejected_by_policy', observation: { processStarted: false } } });
    } finally {
      await closeElectronApp(app);
    }
  });
});
