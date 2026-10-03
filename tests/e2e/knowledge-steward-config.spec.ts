import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Knowledge steward config (Area 5 §3.5)', () => {
  test('review tab shows steward section and Configure modal switches active variant', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      const state = {
        stewardConfigUpdateCount: 0,
        lastDefaultRoleId: '',
        registry: {
          version: 1 as const,
          defaultRoleId: 'knowledge-steward',
          roles: [
            {
              enabled: true,
              roleId: 'knowledge-steward',
              capabilities: {
                canSearch: true,
                canRead: true,
                canProposeDraft: true,
                canClassify: true,
                canSuggestMerge: true,
                canSuggestArchive: true,
                canApplyDirectly: false as const,
              },
              scope: { workspace: true, agent: true, global: true },
              displayName: 'Steward',
              description: 'Default heuristic steward.',
              classification: 'heuristic' as const,
              reviewFocus: ['classification', 'duplicates'],
            },
            {
              enabled: true,
              roleId: 'knowledge-critic',
              capabilities: {
                canSearch: true,
                canRead: true,
                canProposeDraft: true,
                canClassify: true,
                canSuggestMerge: true,
                canSuggestArchive: true,
                canApplyDirectly: false as const,
              },
              scope: { workspace: true, agent: true, global: true },
              displayName: 'Critic',
              description: 'Conflict-focused semantic steward.',
              classification: 'semantic' as const,
              reviewFocus: ['conflicts', 'freshness'],
            },
          ],
        },
      };

      (globalThis as unknown as { __stewardConfigState: typeof state }).__stewardConfigState = state;

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }) => {
        const current = (globalThis as unknown as { __stewardConfigState: typeof state }).__stewardConfigState;

        if (request?.module === 'gateway' && request.action === 'status') {
          return respond(request.id, { state: 'running', port: 18789 });
        }

        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, {
            success: true,
            agents: [{ id: 'main', name: 'Main', isDefault: true, mainSessionKey: 'agent:main:session' }],
          });
        }

        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, { success: true, channels: [] });
        }

        if (request?.module === 'providers') {
          if (request.action === 'accounts') return respond(request.id, { success: true, accounts: [] });
          if (request.action === 'accountKeyInfo') return respond(request.id, { success: true, keyInfo: {} });
          if (request.action === 'vendors') return respond(request.id, { success: true, vendors: [] });
          if (request.action === 'getDefaultAccount') return respond(request.id, { success: true, accountId: null });
        }

        if (request?.module === 'knowledge') {
          const action = request.action;

          if (action === 'status') {
            return respond(request.id, {
              success: true,
              status: {
                vaultExists: true,
                vaultPath: 'C:/clawx/wiki',
                vaultMode: 'isolated',
                renderMode: 'native',
                pageCounts: { source: 2, synthesis: 1 },
                sourceCounts: { native: 2 },
                warnings: [],
                obsidianCli: { available: false },
              },
            });
          }

          if (action === 'listDrafts') {
            return respond(request.id, {
              success: true,
              drafts: [
                {
                  id: 'draft-steward-1',
                  title: 'Steward-reviewed decision',
                  body: 'Adopt the registry pattern for steward variants.',
                  type: 'decision',
                  status: 'steward_reviewed',
                  sourceIds: ['notes/registry.md'],
                  sourceRefs: [],
                  tags: ['governance'],
                  workspaceId: null,
                  agentId: null,
                  createdBy: 'agent',
                  stewardNotes: 'Classified as decision; no conflicts detected.',
                  warnings: [],
                  createdAt: '2026-07-03T00:00:00.000Z',
                  updatedAt: '2026-07-03T00:00:00.000Z',
                },
                {
                  id: 'draft-pending-1',
                  title: 'Pending synthesis',
                  body: 'Draft awaiting review.',
                  type: 'synthesis',
                  status: 'draft',
                  sourceIds: [],
                  sourceRefs: [],
                  tags: [],
                  workspaceId: null,
                  agentId: null,
                  createdBy: 'user',
                  createdAt: '2026-07-03T00:00:00.000Z',
                  updatedAt: '2026-07-03T00:00:00.000Z',
                },
              ],
            });
          }

          if (action === 'listInboxItems') {
            return respond(request.id, { success: true, items: [] });
          }

          if (action === 'listProposals') {
            return respond(request.id, { success: true, proposals: [] });
          }

          if (action === 'stewardConfigGet') {
            const registry = current.registry;
            const activeRole = registry.roles.find((role) => role.roleId === registry.defaultRoleId);
            return respond(request.id, { success: true, registry, activeRole });
          }

          if (action === 'stewardConfigUpdate') {
            current.stewardConfigUpdateCount += 1;
            const payload = request.payload ?? {};
            const newDefault = typeof payload.defaultRoleId === 'string' ? payload.defaultRoleId : current.registry.defaultRoleId;
            current.lastDefaultRoleId = newDefault;
            current.registry = { ...current.registry, defaultRoleId: newDefault };
            const activeRole = current.registry.roles.find((role) => role.roleId === newDefault);
            return respond(request.id, { success: true, registry: current.registry, activeRole });
          }

          if (action === 'stewardReview') {
            return respond(request.id, {
              success: true,
              config: {
                enabled: true,
                roleId: current.registry.defaultRoleId,
                capabilities: {
                  canSearch: true,
                  canRead: true,
                  canProposeDraft: true,
                  canClassify: true,
                  canSuggestMerge: true,
                  canSuggestArchive: true,
                  canApplyDirectly: false,
                },
                scope: { workspace: true, agent: true, global: true },
              },
              type: 'decision',
              tags: ['governance'],
              warnings: ['Source density is below threshold.'],
              notes: 'Classified as decision; consider adding a second source.',
            });
          }
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-knowledge').click();
    await expect(page.getByTestId('knowledge-page')).toBeVisible();

    // The single-draft review view is now reached through the Review Queue tab:
    // open the queue, then select a review item to enter the review workspace.
    await page.getByTestId('knowledge-tab-review-queue').click();
    await expect(page.getByTestId('knowledge-review-queue')).toBeVisible();
    await page.getByTestId('knowledge-review-item').filter({ hasText: 'Steward-reviewed decision' }).click();
    await expect(page.getByTestId('knowledge-review')).toBeVisible();

    // Steward review result section is present (no review yet for no selected draft).
    await expect(page.getByTestId('knowledge-steward-review-result')).toBeVisible();
    await expect(page.getByTestId('knowledge-steward-review-result')).toContainText(/No steward review/);

    // Steward queue shows the steward_reviewed draft.
    await expect(page.getByTestId('knowledge-steward-queue')).toBeVisible();
    await expect(page.getByTestId('knowledge-steward-queue')).toContainText('Steward-reviewed decision');

    // Clicking the queue item selects that draft.
    await page.getByTestId('knowledge-steward-queue').getByRole('button', { name: /Steward-reviewed decision/ }).click();

    // Configure Steward button opens the modal.
    await page.getByTestId('knowledge-steward-configure').click();
    await expect(page.getByTestId('knowledge-steward-config-modal')).toBeVisible();

    // Both variants are listed; the default is active.
    await expect(page.getByTestId('knowledge-steward-variant-knowledge-steward')).toContainText('Steward');
    await expect(page.getByTestId('knowledge-steward-variant-knowledge-steward')).toContainText('Active');
    await expect(page.getByTestId('knowledge-steward-variant-knowledge-critic')).toContainText('Critic');

    // Boundary notice is always shown.
    await expect(page.getByTestId('knowledge-steward-config-modal')).toContainText(/can never apply changes directly/);

    // Switch active variant to Critic.
    await page.getByTestId('knowledge-steward-variant-set-active-knowledge-critic').click();

    // After the update, Critic becomes active and the Set-as-active button is gone.
    await expect(page.getByTestId('knowledge-steward-variant-knowledge-critic')).toContainText('Active');
    await expect(page.getByTestId('knowledge-steward-variant-set-active-knowledge-critic')).toHaveCount(0);

    // Close the modal via the bottom "Close" button (the X icon is also aria-label="Close").
    await page.getByTestId('knowledge-steward-config-modal').getByRole('button', { name: /Close/ }).last().click();
    await expect(page.getByTestId('knowledge-steward-config-modal')).toHaveCount(0);

    // Verify the stewardConfigUpdate IPC was called with the critic role id.
    const calls = await electronApp.evaluate(() => {
      const state = (globalThis as unknown as {
        __stewardConfigState?: { stewardConfigUpdateCount: number; lastDefaultRoleId: string };
      }).__stewardConfigState;
      return {
        stewardConfigUpdateCount: state?.stewardConfigUpdateCount ?? 0,
        lastDefaultRoleId: state?.lastDefaultRoleId ?? '',
      };
    });
    expect(calls.stewardConfigUpdateCount).toBe(1);
    expect(calls.lastDefaultRoleId).toBe('knowledge-critic');
  });
});
