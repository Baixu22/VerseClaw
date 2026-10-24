import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Role memory panel', () => {
  test('shows proposal source metadata in the review queue and applies review decisions through gateway RPC', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      type ReviewProposal = {
        id: string;
        operation: string;
        status: string;
        decision: string;
        proposal: { content: string; source: string; confidence: number; sensitivity: string };
        riskLevel: string;
        impactScope: string;
        suggestedAction: string;
        evidenceStatus: string;
        reviewReason: string;
        reasonSummary: string;
      };
      const state = {
        reviewBatchCount: 0,
        proposals: [{
          id: 'proposal-source-1',
          operation: 'create',
          status: 'needs_review',
          decision: 'needs_review',
          proposal: {
            content: 'Record migration notes only after user-visible review.',
            source: 'session_summary',
            confidence: 0.71,
            sensitivity: 'low',
          },
          riskLevel: 'medium',
          impactScope: 'role',
          suggestedAction: 'approve',
          evidenceStatus: 'partial',
          reviewReason: 'Missing source metadata needs review.',
          reasonSummary: 'Needs review because source metadata is incomplete.',
        }] as ReviewProposal[],
      };

      (globalThis as unknown as { __roleMemorySourceState: typeof state }).__roleMemorySourceState = state;

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: { method?: string; params?: Record<string, unknown> };
      }) => {
        const current = (globalThis as unknown as { __roleMemorySourceState: typeof state }).__roleMemorySourceState;

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
          return respond(request.id, request.action === 'snapshot'
            ? { success: true, accounts: [], statuses: [], vendors: [], defaultAccountId: '' }
            : { success: true, accounts: [], vendors: [], keyInfo: {}, accountId: null });
        }

        if (request?.module === 'gateway' && request.action === 'rpc') {
          const method = request.payload?.method;
          const params = request.payload?.params ?? {};

          if (method === 'roles.list') {
            return respond(request.id, {
              roles: [{
                name: 'architect',
                displayName: 'Architect',
                description: 'Designs the system shape.',
                rolePrompt: 'Designs the system shape.',
                tools: ['read'],
                effort: 'high',
              }],
            });
          }

          if (method === 'memory.proposals') {
            return respond(request.id, { proposals: current.proposals.filter((proposal) => proposal.status === 'needs_review') });
          }

          if (method === 'memory.reviewBatch') {
            current.reviewBatchCount += 1;
            const ids = params.ids as string[] | undefined;
            for (const proposal of current.proposals) {
              if (ids?.includes(proposal.id)) proposal.status = 'applied';
            }
            return respond(request.id, { batchId: 'batch-source-1', results: (ids ?? []).map((id) => ({ id, ok: true })) });
          }

          if (method === 'memory.list') return respond(request.id, { cards: [] });
          if (method === 'memory.conflicts') return respond(request.id, { conflicts: [] });
          if (method === 'memory.retentionCandidates') return respond(request.id, { candidates: [] });
          if (method === 'memory.health') return respond(request.id, { health: { ok: true, checks: [] } });
          if (method === 'memory.stats') {
            return respond(request.id, {
              stats: {
                active: 0,
                conflictsOpen: 0,
                proposalsNeedsReview: current.proposals.filter((proposal) => proposal.status === 'needs_review').length,
              },
            });
          }
        }

        if (request?.module === 'memory') {
          if (request.action === 'list') return respond(request.id, { success: true, cards: [] });
          if (request.action === 'health') return respond(request.id, { success: true, ok: true, checks: [] });
          if (request.action === 'proposeFactsList') return respond(request.id, { success: true, enabled: false, candidates: [] });
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-agents').click();
    await expect(page.getByTestId('agents-page')).toBeVisible();

    await page.getByTestId('role-orchestration-toggle').click();
    await page.getByRole('button', { name: /Architect/ }).click();
    await expect(page.getByTestId('role-memory-panel')).toBeVisible();
    await page.getByTestId('role-memory-composer-info').hover();
    await expect(page.getByText('Candidates remain review-only. Explicit approval is required before any candidate can become memory.')).toBeVisible();
    await expect(page.getByText(/automatic long-term memory|every task.*memory|automatically/i)).toHaveCount(0);

    await page.getByTestId('role-memory-review-tab').click();
    await expect(page.getByTestId('role-memory-proposal-source')).toContainText('session_summary');
    await expect(page.getByTestId('role-memory-proposal-confidence')).toContainText('71%');
    await expect(page.getByTestId('role-memory-proposal-needs-review')).toContainText('Needs review because source metadata is incomplete.');
    await expect(page.getByText(/automatic long-term memory|every task.*memory|automatically/i)).toHaveCount(0);

    await page.getByLabel('Select proposal').first().check();
    await page.getByRole('button', { name: /Approve selected/ }).click();
    await expect(page.getByTestId('role-memory-proposal-source')).toHaveCount(0);

    const calls = await electronApp.evaluate(() => {
      const state = (globalThis as unknown as { __roleMemorySourceState?: { reviewBatchCount: number } }).__roleMemorySourceState;
      return { reviewBatchCount: state?.reviewBatchCount ?? 0 };
    });
    expect(calls).toEqual({ reviewBatchCount: 1 });
  });

  test('creates and archives role memory through gateway RPC', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      const state = {
        proposeCount: 0,
        previewCount: 0,
        archiveCount: 0,
        retentionProposeCount: 0,
        reviewBatchCount: 0,
        simulateCount: 0,
        feedbackCount: 0,
        proposals: [] as Array<{
          id: string;
          operation: string;
          status: string;
          decision: string;
          proposal: { content: string; sensitivity?: string };
          riskLevel?: string;
          impactScope?: string;
          suggestedAction?: string;
          evidenceStatus?: string;
          retentionReason?: string;
        }>,
        cards: [{
          id: 'mem-1',
          type: 'role_experience',
          status: 'active',
          content: 'Prefer migration notes before schema changes.',
          confidence: 0.9,
          importance: 0.7,
        }],
      };

      (globalThis as unknown as { __roleMemoryPanelState: typeof state }).__roleMemoryPanelState = state;

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: { method?: string; params?: Record<string, unknown> };
      }) => {
        const current = (globalThis as unknown as { __roleMemoryPanelState: typeof state }).__roleMemoryPanelState;

        if (request?.module === 'gateway' && request.action === 'status') {
          return respond(request.id, { state: 'running', port: 18789 });
        }

        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, {
            success: true,
            agents: [{
              id: 'main',
              name: 'Main',
              isDefault: true,
              mainSessionKey: 'agent:main:session',
            }],
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

        if (request?.module === 'gateway' && request.action === 'rpc') {
          const method = request.payload?.method;
          const params = request.payload?.params ?? {};

          if (method === 'roles.list') {
            return respond(request.id, {
              roles: [{
                name: 'architect',
                displayName: 'Architect',
                description: 'Designs the system shape.',
                rolePrompt: 'Designs the system shape.',
                tools: ['read'],
                effort: 'high',
              }],
            });
          }

          if (method === 'memory.list') {
            return respond(request.id, { cards: current.cards.filter((card) => card.status === 'active') });
          }

          if (method === 'memory.proposals') {
            return respond(request.id, { proposals: current.proposals });
          }

          if (method === 'memory.previewProposal') {
            current.previewCount += 1;
            const proposal = params.proposal as { content?: string; type?: string; scope?: string; sensitivity?: string } | undefined;
            return respond(request.id, {
              preview: {
                operation: params.operation ?? 'create',
                proposal,
                normalized: {
                  ...proposal,
                  confidence: 0.85,
                  importance: 0.55,
                  applicableRoles: ['architect'],
                },
                decision: { action: 'accept', accepted: true, reason: 'Low-risk memory mutation is allowed by policy.' },
                conflicts: [],
                evidence: { status: 'verified', summary: 'Manual evidence was provided.' },
                riskLevel: 'low',
                impactScope: proposal?.scope ?? 'role',
                suggestedAction: 'approve',
                reasonSummary: 'low risk create on role procedure',
                permissionDecision: 'allow',
                permissionReason: 'Low-risk memory mutation is allowed by policy.',
                wouldWrite: false,
              },
            });
          }

          if (method === 'memory.conflicts') {
            return respond(request.id, { conflicts: [] });
          }

          if (method === 'memory.explainInjection') {
            return respond(request.id, {
              injections: [{
                id: 'inj-1',
                roleName: 'architect',
                createdAt: '2026-06-16T00:00:00.000Z',
                truncated: false,
                policyVersion: 'role-memory-context-v3',
                cardIds: ['mem-1'],
                candidateExplanations: [{
                  cardId: 'mem-1',
                  selected: true,
                  score: 0.91,
                  reason: 'Injected as a must role constraint.',
                  penalties: [],
                  injectionClass: 'must',
                }],
              }],
            });
          }

          if (method === 'memory.stats') {
            return respond(request.id, {
              stats: {
                active: current.cards.filter((card) => card.status === 'active').length,
                conflictsOpen: 0,
                proposalsNeedsReview: 0,
              },
            });
          }

          if (method === 'memory.retentionCandidates') {
            return respond(request.id, {
              candidates: current.cards
                .filter((card) => card.status === 'active')
                .slice(0, 1)
                .map((card) => ({
                  card,
                  recommendedAction: 'cold',
                  retentionScore: 0.3,
                  labels: ['Rarely used'],
                  reason: 'Low-use active memory should be cooled before archival.',
                })),
            });
          }

          if (method === 'memory.health') {
            return respond(request.id, { health: { ok: true, checks: [] } });
          }

          if (method === 'memory.utilityReport') {
            return respond(request.id, {
              report: {
                roleName: 'architect',
                generatedAt: '2026-06-16T00:00:00.000Z',
                dataQuality: current.feedbackCount > 0 ? 'partial' : 'insufficient',
                missingEvidence: current.feedbackCount > 0
                  ? ['No memory-on/off evaluation pairs are available, so task success delta is not computed.']
                  : [
                    'No user/reviewer utility feedback has been recorded yet.',
                    'No memory-on/off evaluation pairs are available, so task success delta is not computed.',
                  ],
                sample: {
                  cards: current.cards.length,
                  injections: 1,
                  feedback: current.feedbackCount,
                  proposals: current.proposals.length,
                  conflicts: 0,
                },
                aggregate: {
                  contextPrecisionAtK: current.feedbackCount > 0 ? 1 : null,
                  helpfulnessRate: current.feedbackCount > 0 ? 1 : null,
                  harmRate: current.feedbackCount > 0 ? 0 : null,
                  staleRate: 0.5,
                  conflictRate: 0,
                  reviewAcceptanceRate: null,
                  tokenOverheadPerRun: 40,
                  taskSuccessDelta: null,
                },
                cards: current.cards.map((card) => ({
                  cardId: card.id,
                  card,
                  selectedCount: 1,
                  skippedCount: 0,
                  feedbackCount: current.feedbackCount,
                  helpfulCount: current.feedbackCount,
                  neutralCount: 0,
                  harmfulCount: 0,
                  missingNeededCount: 0,
                  userCorrectedCount: 0,
                  conflictCount: 0,
                  retentionAction: card.status === 'active' ? 'cold' : 'keep',
                  utilityScore: current.feedbackCount > 0 ? 1 : null,
                  dataQuality: current.feedbackCount > 0 ? 'partial' : 'insufficient',
                  reasonSummary: current.feedbackCount > 0 ? '1 helpful feedback record.' : 'Insufficient direct feedback for a utility score.',
                })),
              },
            });
          }

          if (method === 'memory.detail') {
            const id = String(params.id ?? '');
            const card = current.cards.find((entry) => entry.id === id);
            return respond(request.id, {
              card,
              proposals: [],
              conflicts: [],
              versions: card ? [{ id: 'ver-1', cardId: card.id, version: 1, createdAt: '2026-06-16T00:00:00.000Z' }] : [],
              audit: [],
              injections: [],
            });
          }

          if (method === 'memory.propose') {
            const proposal = params.proposal as { content?: string } | undefined;
            current.proposeCount += 1;
            current.cards.push({
              id: `mem-${current.cards.length + 1}`,
              type: 'role_experience',
              status: 'active',
              content: proposal?.content ?? '',
              confidence: 0.85,
              importance: 0.55,
            });
            return respond(request.id, { accepted: true, card: current.cards.at(-1) });
          }

          if (method === 'memory.retentionPropose') {
            current.retentionProposeCount += 1;
            const cardId = String(params.cardId ?? '');
            const card = current.cards.find((entry) => entry.id === cardId);
            current.proposals.push({
              id: `prop-${current.proposals.length + 1}`,
              operation: 'update',
              status: 'needs_review',
              decision: 'needs_review',
              proposal: { content: card?.content ?? '' },
              riskLevel: 'low',
              impactScope: 'role',
              suggestedAction: 'applyAsCold',
              evidenceStatus: 'verified',
              retentionReason: 'Low-use active memory should be cooled before archival.',
            });
            return respond(request.id, { runId: 'ret-1', proposals: current.proposals });
          }

          if (method === 'memory.reviewBatch') {
            current.reviewBatchCount += 1;
            const ids = params.ids as string[] | undefined;
            for (const proposal of current.proposals) {
              if (ids?.includes(proposal.id)) proposal.status = 'applied';
            }
            const card = current.cards.find((entry) => entry.id === 'mem-1');
            if (card) card.status = 'cold';
            return respond(request.id, { batchId: 'batch-1', results: (ids ?? []).map((id) => ({ id, ok: true })) });
          }

          if (method === 'memory.simulateInjection') {
            current.simulateCount += 1;
            return respond(request.id, {
              roleName: 'architect',
              pack: {
                policyVersion: 'role-memory-context-v3',
                candidateExplanations: [{
                  cardId: 'mem-1',
                  selected: true,
                  score: 0.91,
                  reason: 'Injected as a must role constraint.',
                  penalties: [],
                  injectionClass: 'must',
                }],
                budget: { total: 200 },
                estimatedTokens: { total: 40 },
              },
              selectedCards: [current.cards[0]],
            });
          }

          if (method === 'memory.feedback') {
            current.feedbackCount += 1;
            return respond(request.id, {
              feedback: {
                id: `fb-${current.feedbackCount}`,
                cardId: params.cardId,
                injectionId: params.injectionId,
                roleName: params.roleName,
                outcome: params.outcome,
                taskSuccess: params.taskSuccess ?? 'unknown',
                createdAt: '2026-06-16T00:00:00.000Z',
              },
            });
          }

          if (method === 'memory.archive') {
            current.archiveCount += 1;
            const id = String(params.id ?? '');
            const card = current.cards.find((entry) => entry.id === id);
            if (card) card.status = 'archived';
            return respond(request.id, { card });
          }
        }

        // Area 4 Phase 6: typed memory facade mocks.
        // The renderer now calls hostApi.memory.* (module='memory') for 6 migrated
        // methods. These reach Main's createMemoryApi which would forward to
        // gateway.rpc — but in the E2E env there's no real gateway, so we mock
        // at the IPC level and return the typed-facade result shape (HostSuccess
        // & data, with health flattened).
        if (request?.module === 'memory') {
          const action = request.action;
          if (action === 'proposeFactsList') return respond(request.id, { success: true, enabled: false, candidates: [] });
          const payload = request.payload ?? {};

          if (action === 'list') {
            return respond(request.id, {
              success: true,
              cards: current.cards.filter((card) => card.status === 'active'),
            });
          }

          if (action === 'explainInjection') {
            return respond(request.id, {
              success: true,
              injections: [{
                id: 'inj-1',
                roleName: 'architect',
                createdAt: '2026-06-16T00:00:00.000Z',
                truncated: false,
                policyVersion: 'role-memory-context-v3',
                cardIds: ['mem-1'],
                candidateExplanations: [{
                  cardId: 'mem-1',
                  selected: true,
                  score: 0.91,
                  reason: 'Injected as a must role constraint.',
                  penalties: [],
                  injectionClass: 'must',
                }],
              }],
            });
          }

          if (action === 'health') {
            // Typed facade flattens envelope.health to top level.
            return respond(request.id, { success: true, ok: true, checks: [] });
          }

          if (action === 'detail') {
            const id = String((payload as { id?: string }).id ?? '');
            const card = current.cards.find((entry) => entry.id === id);
            return respond(request.id, {
              success: true,
              card,
              proposals: [],
              conflicts: [],
              versions: card ? [{ id: 'ver-1', cardId: card.id, version: 1, createdAt: '2026-06-16T00:00:00.000Z' }] : [],
              audit: [],
              injections: [],
            });
          }

          if (action === 'propose') {
            const proposal = payload as { content?: string } | undefined;
            current.proposeCount += 1;
            const newCard = {
              id: `mem-${current.cards.length + 1}`,
              type: 'role_experience',
              status: 'active',
              content: proposal?.content ?? '',
              confidence: 0.85,
              importance: 0.55,
            };
            current.cards.push(newCard);
            return respond(request.id, { success: true, accepted: true, card: newCard });
          }

          if (action === 'update') {
            const updatePayload = payload as { id?: string; patch?: { content?: string } };
            const id = String(updatePayload?.id ?? '');
            const card = current.cards.find((entry) => entry.id === id);
            if (card && updatePayload?.patch?.content !== undefined) {
              card.content = updatePayload.patch.content;
            }
            return respond(request.id, { success: true, accepted: true, card });
          }
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-agents').click();
    await expect(page.getByTestId('agents-page')).toBeVisible();

    await page.getByTestId('role-orchestration-toggle').click();
    await page.getByRole('button', { name: /Architect/ }).click();

    await expect(page.getByTestId('role-memory-panel')).toBeVisible();
    await expect(page.getByTestId('role-memory-card')).toContainText('Prefer migration notes');

    await page.getByRole('button', { name: /Create proposal/ }).first().click();
    await page.getByRole('tab', { name: /Review/ }).click();
    await page.getByLabel('Select proposal').first().check();
    await page.getByRole('button', { name: /Cold selected/ }).click();

    await page.getByRole('tab', { name: /Injections/ }).click();
    await page.getByTestId('role-memory-simulate').click();
    await expect(page.getByTestId('role-memory-simulation-result')).toContainText('mem-1');
    await page.getByRole('button', { name: /Helpful/ }).first().click();

    await page.getByRole('tab', { name: /Quality/ }).click();
    await expect(page.getByTestId('role-memory-quality')).toContainText('partial');
    await expect(page.getByTestId('role-memory-quality')).toContainText('100%');

    await page.getByRole('tab', { name: /Active/ }).click();

    await page.getByTestId('role-memory-input').fill('Check injection explain logs after orchestration.');
    await page.getByTestId('role-memory-preview-button').click();
    await expect(page.getByTestId('role-memory-preview')).toContainText('low risk');
    await page.getByTestId('role-memory-save').click();

    await expect(page.getByTestId('role-memory-card').filter({ hasText: 'Check injection explain logs' })).toBeVisible();

    await page.getByTestId('role-memory-archive').first().click();
    await expect(page.getByTestId('role-memory-card').filter({ hasText: 'Prefer migration notes' })).toHaveCount(0);

    const calls = await electronApp.evaluate(() => {
      const state = (globalThis as unknown as {
        __roleMemoryPanelState?: {
          proposeCount: number;
          previewCount: number;
          archiveCount: number;
          retentionProposeCount: number;
          reviewBatchCount: number;
          simulateCount: number;
          feedbackCount: number;
        };
      }).__roleMemoryPanelState;
      return {
        proposeCount: state?.proposeCount ?? 0,
        previewCount: state?.previewCount ?? 0,
        archiveCount: state?.archiveCount ?? 0,
        retentionProposeCount: state?.retentionProposeCount ?? 0,
        reviewBatchCount: state?.reviewBatchCount ?? 0,
        simulateCount: state?.simulateCount ?? 0,
        feedbackCount: state?.feedbackCount ?? 0,
      };
    });
    expect(calls).toEqual({ proposeCount: 1, previewCount: 1, archiveCount: 1, retentionProposeCount: 1, reviewBatchCount: 1, simulateCount: 1, feedbackCount: 1 });
  });
});
