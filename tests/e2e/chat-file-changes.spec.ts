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

// A code edit only renders a trustworthy inline diff when the Edit tool result
// carries a strictly-validated GitPatchArtifact/v1 (schema + complete hunks +
// patch text + lineage matching the tool-call id + a write-journal snapshot).
// The renderer deliberately "fails closed" and shows no diff for a bare
// old/new-string edit with no artifact (see the fail-closed cases in
// tests/unit/generated-files.test.ts), so the fixture has to mirror the real
// runtime payload. The tool input path and artifact.file are the same
// repository-relative path, exactly as the runtime emits them.
const editPatchResult = {
  toolCallId: 'edit-1',
  toolName: 'Edit',
  result: {
    patchArtifacts: [{
      schema: 'GitPatchArtifact/v1',
      file: 'demo.ts',
      status: 'modified',
      contentKind: 'text',
      hunks: [{
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { kind: 'deletion', text: 'const value = 1', oldLine: 1, newLine: null },
          { kind: 'addition', text: 'const value = 2', oldLine: null, newLine: 1 },
        ],
      }],
      patch: ['--- demo.ts', '+++ demo.ts', '@@ -1,1 +1,1 @@', '-const value = 1', '+const value = 2'].join('\n'),
      completeness: 'complete',
      lineage: { requestId: 'edit-1', journalEntryId: 'write-journal:session:1' },
    }],
    write_journal: {
      snapshots: [{ path: 'demo.ts', journalEntryId: 'write-journal:session:1', hadPrior: true }],
    },
  },
};

const history = [
  {
    role: 'user',
    id: 'user-1',
    content: [{ type: 'text', text: 'Patch the workspace file' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    id: 'assistant-tool-1',
    content: [{
      type: 'toolCall',
      id: 'edit-1',
      name: 'Edit',
      arguments: {
        file_path: 'demo.ts',
        old_string: 'const value = 1\n',
        new_string: 'const value = 2\n',
      },
    }],
    _toolResults: [editPatchResult],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    id: 'assistant-final-1',
    content: [{ type: 'text', text: 'Updated the file.' }],
    timestamp: Date.now(),
  },
];

const attachedFileHistory = [
  {
    role: 'user',
    id: 'user-attached-1',
    content: [{ type: 'text', text: '查看这个技能文件' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    id: 'assistant-attached-1',
    content: [{ type: 'text', text: '这是文件。' }],
    _attachedFiles: [
      {
        fileName: 'SKILL.md',
        mimeType: 'text/markdown',
        fileSize: 128,
        preview: null,
        filePath: '/workspace/skills/open-xueqiu/SKILL.md',
        source: 'tool-result',
      },
    ],
    timestamp: Date.now(),
  },
];

const htmlFileHistory = [
  {
    role: 'user',
    id: 'user-html-1',
    content: [{ type: 'text', text: '预览 HTML 页面' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    id: 'assistant-html-1',
    content: [{ type: 'text', text: '已生成 /workspace/demo.html' }],
    timestamp: Date.now(),
  },
];
test.describe('Verse Claw chat file changes', () => {
  test('shows line stats on generated file cards', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: history },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: history },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.remove('dark');
        root.classList.add('light');
      });
      await expect(page.getByTestId('artifact-panel')).toHaveCount(0);

      // A diffable code edit is rendered inline as a mutation code diff, not as
      // a name chip: files with a renderable, artifact-backed diff are owned by
      // the diff surface (RunMutationDiffs) and are no longer repeated in the
      // file-changes chip row (see the F8a "one file, one owner" split in
      // Chat/index.tsx). The per-file line stats live in the diff header.
      const fileDiff = page.getByTestId('chat-mutation-code-diff').filter({ hasText: 'demo.ts' }).first();
      await expect(fileDiff).toBeVisible({ timeout: 30_000 });
      await expect(fileDiff).toContainText('demo.ts');
      await expect(fileDiff).toContainText('+1');
      await expect(fileDiff).toContainText('-1');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('opens html files from chat as rendered previews', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: htmlFileHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: htmlFileHistory },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main', workspace: '/workspace' }],
              },
            },
          },
          // Clicking the file card routes through `openWorkspacePanel({panel:'files'})`
          // → WorkspaceBrowserBody, which resolves the preview by locating the
          // selected path inside the workspace file tree (`files.listTree`) of the
          // active workspace. Without these the tree never loads and the panel
          // shows the empty state instead of the HTML preview.
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [{ id: 'ws-html', name: 'workspace', rootPath: '/workspace', agentId: 'main', activeSessionKey: SESSION_KEY, state: {}, sessionStates: {} }],
            activeWorkspaceId: 'ws-html',
            activeWorkspace: { id: 'ws-html', name: 'workspace', rootPath: '/workspace', agentId: 'main', activeSessionKey: SESSION_KEY, state: {}, sessionStates: {} },
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: 'ws-html',
            activeWorkspace: { id: 'ws-html', name: 'workspace', rootPath: '/workspace', agentId: 'main', activeSessionKey: SESSION_KEY, state: {}, sessionStates: {} },
          },
          [stableStringify(['files', 'listTree', null])]: {
            ok: true,
            root: {
              name: 'workspace', relPath: '', absPath: '/workspace', isDir: true,
              children: [{ name: 'demo.html', relPath: 'demo.html', absPath: '/workspace/demo.html', isDir: false, size: 154 }],
            },
          },
        },
      });

      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        ipcMain.removeHandler('file:stat');
        ipcMain.handle('file:stat', async (_event: unknown, inputPath: string) => ({
          ok: inputPath === '/workspace/demo.html',
          size: 154,
          isFile: inputPath === '/workspace/demo.html',
          isDir: false,
          readOnly: true,
        }));
        ipcMain.removeHandler('file:readText');
        ipcMain.handle('file:readText', async (_event: unknown, inputPath: string) => {
          if (inputPath !== '/workspace/demo.html') return { ok: false, error: 'notFound' };
          return {
            ok: true,
            content: '<!doctype html><html><body><h1 id="title">HTML Rendered Preview</h1><script>document.body.dataset.htmlPreview = "ok";</script></body></html>',
            size: 154,
            mimeType: 'text/html',
            readOnly: true,
          };
        });
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      const htmlFileCard = page.locator('[data-testid="assistant-attachment-card"]').filter({ hasText: 'demo.html' }).first();
      await expect(htmlFileCard).toBeVisible({ timeout: 30_000 });
      await htmlFileCard.click();

      const sidePanel = page.getByTestId('artifact-panel');
      const frame = sidePanel.getByTestId('html-preview-frame');
      await expect(frame).toBeVisible({ timeout: 30_000 });
      await expect(sidePanel.getByText('<!doctype html>')).toHaveCount(0);
      const htmlFrame = frame.contentFrame();
      await expect(htmlFrame.locator('#title')).toHaveText('HTML Rendered Preview');
      await expect(htmlFrame.locator('body')).toHaveAttribute('data-html-preview', 'ok');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps an attached file selected after switching through workspace', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: attachedFileHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: attachedFileHistory },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main', workspace: '/workspace' }],
              },
            },
          },
          // Opening the attached file routes through the workspace file browser,
          // which resolves the preview by finding the file inside the active
          // workspace tree (`files.listTree`). The SKILL.md attachment lives at
          // /workspace/skills/open-xueqiu/SKILL.md, so the tree is nested to that
          // path (findNode walks by relPath).
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [{ id: 'ws-skill', name: 'workspace', rootPath: '/workspace', agentId: 'main', activeSessionKey: SESSION_KEY, state: {}, sessionStates: {} }],
            activeWorkspaceId: 'ws-skill',
            activeWorkspace: { id: 'ws-skill', name: 'workspace', rootPath: '/workspace', agentId: 'main', activeSessionKey: SESSION_KEY, state: {}, sessionStates: {} },
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: 'ws-skill',
            activeWorkspace: { id: 'ws-skill', name: 'workspace', rootPath: '/workspace', agentId: 'main', activeSessionKey: SESSION_KEY, state: {}, sessionStates: {} },
          },
          [stableStringify(['files', 'listTree', null])]: {
            ok: true,
            root: {
              name: 'workspace', relPath: '', absPath: '/workspace', isDir: true,
              children: [{
                name: 'skills', relPath: 'skills', absPath: '/workspace/skills', isDir: true,
                children: [{
                  name: 'open-xueqiu', relPath: 'skills/open-xueqiu', absPath: '/workspace/skills/open-xueqiu', isDir: true,
                  children: [{ name: 'SKILL.md', relPath: 'skills/open-xueqiu/SKILL.md', absPath: '/workspace/skills/open-xueqiu/SKILL.md', isDir: false, size: 128 }],
                }],
              }],
            },
          },
        },
      });

      // The markdown preview renders the file content; a leading `# SKILL.md`
      // heading gives the panel a real <h1> to assert on (the file name itself
      // is only shown as a path label, not a heading).
      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const skillPath = '/workspace/skills/open-xueqiu/SKILL.md';
        ipcMain.removeHandler('file:stat');
        ipcMain.handle('file:stat', async (_event: unknown, inputPath: string) => ({
          ok: inputPath === skillPath,
          size: 128,
          isFile: inputPath === skillPath,
          isDir: false,
          readOnly: true,
        }));
        ipcMain.removeHandler('file:readText');
        ipcMain.handle('file:readText', async (_event: unknown, inputPath: string) => {
          if (inputPath !== skillPath) return { ok: false, error: 'notFound' };
          return { ok: true, content: '# SKILL.md\n\nSkill file body.', size: 128, mimeType: 'text/markdown', readOnly: true };
        });
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      const skillFileCard = page.locator('[data-testid="assistant-attachment-card"]').filter({ hasText: 'SKILL.md' }).first();
      await expect(skillFileCard).toBeVisible({ timeout: 30_000 });
      await skillFileCard.click();

      const sidePanel = page.getByTestId('artifact-panel');
      // The attachment opens in a `files` tab; the markdown preview's `# SKILL.md`
      // heading confirms the file resolved and is selected.
      await expect(sidePanel.getByTestId('artifact-panel-tab-files')).toBeVisible({ timeout: 30_000 });
      await expect(sidePanel.getByRole('heading', { name: 'SKILL.md' })).toBeVisible({ timeout: 30_000 });

      // Switch to a second workspace tab and back: the selected file must
      // persist (open tabs stay mounted; selection is panel-level state, not
      // per-tab). The legacy `browser`/`preview` sub-tabs no longer exist — the
      // panel is a set of canonical tabs (files/artifact/…), so switch via a
      // freshly opened artifact tab and return to the files tab.
      await sidePanel.getByTestId('artifact-panel-new-tab').click();
      await page.getByTestId('artifact-panel-new-tab-artifact').click();
      await expect(sidePanel.getByTestId('artifact-panel-tab-artifact')).toHaveAttribute('aria-selected', 'true');

      await sidePanel.getByTestId('artifact-panel-tab-files').click();
      await expect(sidePanel.getByRole('heading', { name: 'SKILL.md' })).toBeVisible();
      await expect(sidePanel.getByText('No file selected')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
