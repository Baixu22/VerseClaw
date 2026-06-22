import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const baseWorkspace = {
  id: 'workspace-e2e',
  name: 'Project Rules E2E',
  rootPath: 'C:/workspace/project-rules-e2e',
};

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    workspace: baseWorkspace,
    agentsFile: {
      path: `${baseWorkspace.rootPath}/AGENTS.md`,
      relativePath: 'AGENTS.md',
      status: 'present',
      exists: true,
      size: 160,
      content: '# Project Rules\n\nRenderer code must use host-api.\nDo not call `window.electron.ipcRenderer.invoke(...)` directly.\nDo not fetch `http://127.0.0.1:18789` from renderer code.\n',
    },
    ruleFiles: [],
    issues: [],
    contextPreview: {
      items: [
        { id: 'agents', status: 'included' },
        { id: 'harnessSpecs', status: 'referenceOnly' },
        { id: 'clawxRules', status: 'missing', fileCount: 0 },
      ],
    },
    generatedAt: '2026-06-21T00:00:00.000Z',
    ...overrides,
  };
}

async function openProjectRulesCenter(page: import('@playwright/test').Page) {
  await completeSetup(page);
  await page.getByTestId('sidebar-nav-settings').click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await page.getByTestId('settings-nav-system').click();
  await expect(page.getByTestId('settings-project-rules-center')).toBeVisible();
}

test.describe('Project Rules Center', () => {
  test('shows create action when AGENTS.md is missing', async ({ electronApp, page }) => {
    const missingSnapshot = snapshot({
      agentsFile: {
        path: `${baseWorkspace.rootPath}/AGENTS.md`,
        relativePath: 'AGENTS.md',
        status: 'missing',
        exists: false,
        size: 0,
      },
      issues: [{ id: 'agents.missing', severity: 'warning', source: 'agents', path: 'AGENTS.md' }],
      contextPreview: {
        items: [
          { id: 'agents', status: 'missing' },
          { id: 'harnessSpecs', status: 'referenceOnly' },
          { id: 'clawxRules', status: 'missing', fileCount: 0 },
        ],
      },
    });
    const createdSnapshot = snapshot({ templateCreated: true });
    await installIpcMocks(electronApp, {
      hostApi: {
        [stableStringify(['projectRules', 'snapshot', null])]: missingSnapshot,
        [stableStringify(['projectRules', 'createAgentsTemplate', null])]: createdSnapshot,
      },
    });

    await openProjectRulesCenter(page);
    await expect(page.getByTestId('project-rules-missing')).toBeVisible();
    await page.getByTestId('project-rules-create-agents').click();
    await expect(page.getByTestId('project-rules-agents-preview')).toContainText('Renderer code must use host-api');
  });

  test('previews AGENTS.md and lists local rule files', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      hostApi: {
        [stableStringify(['projectRules', 'snapshot', null])]: snapshot({
          ruleFiles: [{
            name: 'renderer.md',
            path: `${baseWorkspace.rootPath}/.clawx/rules/renderer.md`,
            relativePath: '.clawx/rules/renderer.md',
            status: 'present',
            size: 80,
          }],
          contextPreview: {
            items: [
              { id: 'agents', status: 'included' },
              { id: 'harnessSpecs', status: 'referenceOnly' },
              { id: 'clawxRules', status: 'available', fileCount: 1 },
            ],
          },
        }),
      },
    });

    await openProjectRulesCenter(page);
    await expect(page.getByTestId('project-rules-agents-preview')).toContainText('Project Rules');
    await expect(page.getByTestId('project-rules-file')).toContainText('.clawx/rules/renderer.md');
    await expect(page.getByTestId('project-rules-context-preview')).toContainText('AGENTS.md');
  });

  test('shows deterministic validation warnings', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      hostApi: {
        [stableStringify(['projectRules', 'snapshot', null])]: snapshot({
          issues: [
            { id: 'renderer.ipcBanMissing', severity: 'warning', source: 'agents', path: 'AGENTS.md' },
          ],
        }),
      },
    });

    await openProjectRulesCenter(page);
    await expect(page.getByTestId('project-rules-issue')).toContainText('Direct renderer IPC warning is missing');
  });
});
