import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function typed(module: string, action: string, payload: unknown = null): string {
  return stableStringify([module, action, payload]);
}

const readyProviderAccount = {
  id: 'knowledge-ks04-e2e-provider',
  vendorId: 'ollama',
  label: 'Knowledge KS-04 E2E',
  authMode: 'local',
  model: 'llama3.2',
  enabled: true,
  isDefault: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const readyProviderHostApi = {
  [typed('providers', 'accounts')]: [readyProviderAccount],
  [typed('providers', 'accountKeyInfo')]: [],
  [typed('providers', 'vendors')]: [],
  [typed('providers', 'getDefaultAccount')]: { accountId: readyProviderAccount.id },
};

async function installKs04ChatDenialRecorder(app: import('@playwright/test').ElectronApplication): Promise<void> {
  await app.evaluate(async () => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: Record<string, unknown>) => Promise<unknown>>;
    })._invokeHandlers;
    const previous = handlers?.get('host:invoke');
    if (!previous) return;
    (globalThis as unknown as { __ks04ChatDenialPayload?: unknown }).__ks04ChatDenialPayload = null;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Record<string, unknown>) => {
      if (request.module === 'chat' && request.action === 'sendWithMedia') {
        (globalThis as unknown as { __ks04ChatDenialPayload?: unknown }).__ks04ChatDenialPayload = request.payload;
        return {
          id: request.id as string | undefined,
          ok: true,
          data: {
            success: true,
            result: { runId: 'run-ks04-denials' },
            knowledgeDenials: [{
              id: 'context-palette-page',
              title: 'Context Palette Notes',
              lookup: 'knowledge/context-palette.md',
              reason: 'acl_denied',
              visibleReason: 'ACL denied for "Context Palette Notes".',
            }],
          },
        };
      }
      return previous(event, request);
    });
  });
}

test.describe('KS-04 Chat/DCS single consumption path', () => {
  test('shows a visible reason toast when a selected knowledge reference is denied', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {
        [stableStringify(['sessions.list', {}])]: {
          success: true,
          result: { sessions: [] },
        },
      },
      hostApi: {
        ...readyProviderHostApi,
        [typed('knowledge', 'search', { query: 'context palette', maxResults: 8, corpus: 'wiki' })]: {
          success: true,
          results: [{
            id: 'context-palette-page',
            title: 'Context Palette Notes',
            pagePath: 'knowledge/context-palette.md',
            snippet: 'Use slash commands to keep the composer clean.',
          }],
        },
        [typed('knowledge', 'recordKnowledgeReference', null)]: {
          success: true,
        },
      },
    });
    await installKs04ChatDenialRecorder(electronApp);

    await page.reload();
    await completeSetup(page);

    const input = page.getByTestId('chat-composer-input');
    await expect(input).toBeVisible();

    // Attach a wiki reference through the same slash-palette path used by the
    // existing Knowledge Hub E2E, then send. The Main mock returns one denial
    // for that reference, so the Chat UI must surface the visible reason.
    await input.fill('/wiki context palette');
    await input.press('Enter');

    await expect(page.getByTestId('chat-knowledge-search-input')).toHaveValue('context palette');
    await expect(page.getByTestId('chat-knowledge-search-result')).toContainText('Context Palette Notes');
    await page.getByTestId('chat-knowledge-search-result').click();
    await expect(page.getByTestId('chat-knowledge-selected')).toContainText('Context Palette Notes');

    await page.getByTestId('chat-composer-send').click();

    const denialToast = page.locator('[data-sonner-toast]').filter({ hasText: 'knowledge reference was not included' });
    await expect(denialToast).toBeVisible({ timeout: 15_000 });
    await expect(denialToast).toContainText('ACL denied for "Context Palette Notes".');

    // The Chat UI forwards the selected typed ref through the host API.
    // Main-side snippet/body stripping is covered by unit tests.
    await expect.poll(async () => await electronApp.evaluate(() => (
      (globalThis as unknown as {
        __ks04ChatDenialPayload?: {
          knowledgeScope?: string;
          knowledgeReferences?: Array<Record<string, unknown>>;
        } | null;
      }).__ks04ChatDenialPayload
    ))).toMatchObject({
      knowledgeScope: 'wiki',
      knowledgeReferences: [{
        id: 'context-palette-page',
        title: 'Context Palette Notes',
        lookup: 'knowledge/context-palette.md',
        corpus: 'wiki',
      }],
    });
    // Note: renderer-side snippet stripping is not asserted here because this
    // recorder runs before Main normalizes the host API payload; Main-side
    // snippet/body stripping is covered by tests/unit/chat-knowledge-scope.test.ts.
  });
});
