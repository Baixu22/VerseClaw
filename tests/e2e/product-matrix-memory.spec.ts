import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, test } from './fixtures/electron';
import {
  hostInvoke,
  startGateway,
  startScriptedLlm,
  type ScriptedLlmRequest,
} from './fixtures/fp-p1-harness';
import {
  configureSessionChainProvider,
  createSessionChainProject,
} from './fixtures/session-task-chain';

type History = {
  messages?: Array<{ role?: string; content?: unknown }>;
};

type MemoryDecision = {
  action?: string;
  accepted?: boolean;
  reason?: string;
  card?: {
    id: string;
    content: string;
    scope: string;
    scopeKey?: string | null;
    status: string;
  };
  proposal?: {
    id: string;
    status: string;
  };
};

type MemoryCardReadback = {
  cards?: Array<{
    id: string;
    content: string;
    scope: string;
    scopeKey?: string | null;
    status: string;
  }>;
};

type MemoryProposalReadback = {
  proposals?: Array<{ id: string; status: string }>;
};

type MemoryInjectionReceipt = {
  id: string;
  sessionKey?: string;
  cardIds: string[];
  reasons?: Record<string, string>;
};

type RuntimeMemoryReadback = {
  injectPilot?: {
    enabled?: boolean;
    providers?: string[];
    sessions?: unknown;
    totalTokenBudget?: number;
  };
  persist?: unknown;
  provider?: unknown;
  [key: string]: unknown;
};

type RuntimeConfigSnapshot = {
  hash?: string;
  runtimeConfig?: { runtime?: { memory?: RuntimeMemoryReadback } };
  config?: { runtime?: { memory?: RuntimeMemoryReadback } };
};

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: unknown }).text ?? '');
      }
      return JSON.stringify(part);
    }).join('\n');
  }
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

function roleText(request: ScriptedLlmRequest, roles: readonly string[]): string {
  return (request.messages ?? [])
    .filter((message) => roles.includes(message.role))
    .map((message) => contentText(message.content))
    .join('\n');
}

function runtimeMemoryFrom(snapshot: RuntimeConfigSnapshot | undefined): RuntimeMemoryReadback {
  return snapshot?.runtimeConfig?.runtime?.memory
    ?? snapshot?.config?.runtime?.memory
    ?? {};
}

function runtimeMemoryOwnerSettings(memory: RuntimeMemoryReadback): {
  persist: unknown;
  provider: unknown;
} {
  return {
    persist: memory.persist ?? null,
    provider: memory.provider ?? null,
  };
}

function assistantTexts(history: History): string[] {
  return (history.messages ?? [])
    .filter((message) => message.role === 'assistant')
    .map((message) => contentText(message.content));
}

async function waitForAssistantText(
  readHistory: () => Promise<History>,
  expectedText: string,
): Promise<void> {
  await expect.poll(async () => assistantTexts(await readHistory()), {
    timeout: 90_000,
  }).toContain(expectedText);
}

test.describe('TF-0582 product matrix memory acceptance', () => {
  test('accepted workspace memory reaches the next real chat while rejected and cross-session memory stay out', async ({
    launchElectronApp,
  }, testInfo) => {
    test.setTimeout(300_000);

    const evidenceId = randomUUID().replaceAll('-', '');
    const queryMarker = `MEMORY-QUERY-${randomUUID().replaceAll('-', '')}`;
    const acceptedValue = randomUUID().replaceAll('-', '');
    const rejectedValue = randomUUID().replaceAll('-', '');
    const otherScopeValue = randomUUID().replaceAll('-', '');
    const expectedAssistantReadback = `MEMORY-READBACK:${acceptedValue}`;
    const observedRequests: Array<{
      requestIndex: number;
      request: ScriptedLlmRequest;
    }> = [];
    const evidence: Record<string, unknown> = {
      schema: 'clawx.tf0582.product-matrix-memory/v1',
      driven_by: 'agent',
      actor: 'codex-product-matrix-memory',
      provider: 'local-scripted-openai-completions',
      evidenceId,
      status: 'running',
    };

    const llm = await startScriptedLlm(async (
      userText,
      _toolResults,
      requestIndex,
      request,
    ) => {
      if (userText.includes(queryMarker)) {
        observedRequests.push({ requestIndex, request });
        const systemContext = roleText(request, ['system', 'developer']);
        const acceptedMatch = systemContext.match(/ACCEPTED-MEMORY-([a-f0-9]{32})/i);
        if (acceptedMatch?.[1]) {
          return { text: `MEMORY-READBACK:${acceptedMatch[1]}` };
        }
        if (
          systemContext.includes(`REJECTED-MEMORY-${rejectedValue}`)
          || systemContext.includes(`OTHER-SCOPE-MEMORY-${otherScopeValue}`)
        ) {
          return { text: 'MEMORY-SCOPE-LEAK' };
        }
        return { text: 'MEMORY-MISSING' };
      }
      return { text: 'UNEXPECTED-REQUEST' };
    });

    let app: ElectronApplication | undefined;
    let failure: unknown;
    try {
      app = await launchElectronApp({ skipSetup: true });
      const runningApp = app;
      const rpc = <T,>(
        method: string,
        params: Record<string, unknown> = {},
      ) => hostInvoke<T>(runningApp, 'gateway', 'rpc', {
        method,
        params,
        timeoutMs: 60_000,
      });

      await configureSessionChainProvider(app, llm.port);
      const project = await createSessionChainProject(
        app,
        testInfo.outputPath('workspace'),
        `TF0582 memory ${evidenceId.slice(0, 8)}`,
      );
      evidence.workspace = project;
      const beforeConfig = await rpc<RuntimeConfigSnapshot>('config.get');
      if (!beforeConfig.hash) throw new Error(`config.get returned no hash: ${JSON.stringify(beforeConfig)}`);
      const beforeRuntimeMemory = runtimeMemoryOwnerSettings(
        runtimeMemoryFrom(beforeConfig),
      );
      await rpc('config.patch', {
        raw: JSON.stringify({
          runtime: {
            memory: {
              injectPilot: {
                enabled: true,
                providers: ['role-memory'],
                sessions: 'all',
                totalTokenBudget: 1_024,
              },
            },
          },
        }),
        baseHash: beforeConfig.hash,
        note: 'TF-0582 accepted-memory request evidence',
      });
      await hostInvoke(app, 'gateway', 'stop');
      await startGateway(app);
      const patchedConfig = await rpc<RuntimeConfigSnapshot>('config.get');
      const patchedMemory = runtimeMemoryFrom(patchedConfig);
      const injectPilot = patchedMemory.injectPilot;
      expect(injectPilot?.enabled).toBe(true);
      expect(injectPilot?.providers).toEqual(['role-memory']);
      expect(injectPilot?.providers).not.toContain('runtime-memory');
      const afterRuntimeMemory = runtimeMemoryOwnerSettings(patchedMemory);
      expect(afterRuntimeMemory).toEqual(beforeRuntimeMemory);
      evidence.configPolicy = {
        catalogCurrentMode: 'opt-in',
        evidenceMode: 'explicit-role-memory-pilot',
        injectPilot: {
          enabled: injectPilot?.enabled,
          providers: injectPilot?.providers,
          sessions: injectPilot?.sessions,
          totalTokenBudget: injectPilot?.totalTokenBudget,
        },
        runtimeMemoryOwnerSettings: {
          before: beforeRuntimeMemory,
          after: afterRuntimeMemory,
        },
      };

      const otherSessionKey = `agent:main:session-${Date.now()}-memory-other-${evidenceId.slice(0, 8)}`;
      const otherSession = await rpc<{ key: string; sessionId: string }>(
        'sessions.create',
        {
          key: otherSessionKey,
          agentId: 'main',
          label: `TF-0582 memory isolation ${evidenceId.slice(0, 8)}`,
        },
      );
      evidence.otherSession = otherSession;

      const proposePending = async (
        label: string,
        content: string,
        scope: 'workspace' | 'session',
        scopeKey: string,
      ): Promise<{ proposalId: string; proposal: MemoryDecision }> => {
        const proposal = await rpc<MemoryDecision>('memory.propose', {
          proposal: {
            type: 'fact',
            scope,
            scopeKey,
            roleTags: ['main'],
            applicableRoles: ['main'],
            content,
            evidenceRefs: [{
              type: 'manual',
              ref: `tf0582:${evidenceId}:${label}`,
            }],
            confidence: 0.6,
            importance: 0.9,
            sensitivity: 'normal',
            source: 'user',
          },
        });
        expect(proposal.accepted).toBe(false);
        expect(proposal.card).toBeUndefined();
        expect(proposal.proposal?.status).toBe('needs_review');
        if (!proposal.proposal?.id) {
          throw new Error(`memory.propose returned no proposal for ${label}: ${JSON.stringify(proposal)}`);
        }
        return { proposalId: proposal.proposal.id, proposal };
      };

      const acceptedContent = `Accepted Archivist launch fact: opaque value ACCEPTED-MEMORY-${acceptedValue}.`;
      const acceptedCandidate = await proposePending(
        'accepted',
        acceptedContent,
        'workspace',
        project.rootPath,
      );
      const acceptedReview = await rpc<MemoryDecision>('memory.review', {
        id: acceptedCandidate.proposalId,
        action: 'approve',
        reason: 'TF-0582 workspace acceptance',
      });
      expect(acceptedReview.accepted).toBe(true);
      expect(acceptedReview.card?.content).toBe(acceptedContent);
      expect(acceptedReview.card?.scope).toBe('workspace');
      expect(acceptedReview.card?.scopeKey).toBe(project.rootPath);
      expect(acceptedReview.card?.status).toBe('active');
      const acceptedCardId = acceptedReview.card?.id;
      if (!acceptedCardId) throw new Error('Reviewed accepted memory returned no card id');

      const rejectedContent = `Unaccepted Archivist launch fact: opaque value REJECTED-MEMORY-${rejectedValue}. This value must never reach the model.`;
      const rejectedCandidate = await proposePending(
        'rejected',
        rejectedContent,
        'workspace',
        project.rootPath,
      );
      const rejectedReview = await rpc<MemoryDecision>('memory.review', {
        id: rejectedCandidate.proposalId,
        action: 'reject',
        reason: 'TF-0582 negative acceptance gate',
      });
      expect(rejectedReview.accepted).toBe(false);
      expect(rejectedReview.card).toBeUndefined();
      expect(rejectedReview.proposal?.status).toBe('rejected');

      const otherScopeContent = `Other-session Archivist launch fact: opaque value OTHER-SCOPE-MEMORY-${otherScopeValue}. This value belongs only to ${otherSessionKey}.`;
      const otherScopeCandidate = await proposePending(
        'other-scope',
        otherScopeContent,
        'session',
        otherSessionKey,
      );
      const otherScopeReview = await rpc<MemoryDecision>('memory.review', {
        id: otherScopeCandidate.proposalId,
        action: 'approve',
        reason: 'TF-0582 cross-session acceptance',
      });
      expect(otherScopeReview.accepted).toBe(true);
      expect(otherScopeReview.card?.content).toBe(otherScopeContent);
      expect(otherScopeReview.card?.scope).toBe('session');
      expect(otherScopeReview.card?.scopeKey).toBe(otherSessionKey);
      expect(otherScopeReview.card?.status).toBe('active');
      const otherScopeCardId = otherScopeReview.card?.id;
      if (!otherScopeCardId) throw new Error('Reviewed cross-scope memory returned no card id');

      const acceptedOwner = await rpc<MemoryCardReadback>('memory.list', {
        scope: 'workspace',
        scopeKey: project.rootPath,
        status: 'active',
      });
      expect(acceptedOwner.cards).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: acceptedCardId, content: acceptedContent }),
      ]));
      const otherScopeOwner = await rpc<MemoryCardReadback>('memory.list', {
        scope: 'session',
        scopeKey: otherSessionKey,
        status: 'active',
      });
      expect(otherScopeOwner.cards).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: otherScopeCardId, content: otherScopeContent }),
      ]));
      const rejectedOwner = await rpc<MemoryProposalReadback>('memory.proposals', {
        status: 'rejected',
        limit: 100,
      });
      expect(rejectedOwner.proposals).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: rejectedCandidate.proposalId,
          status: 'rejected',
        }),
      ]));
      evidence.ownerReadback = {
        accepted: acceptedOwner,
        rejected: rejectedOwner,
        otherScope: otherScopeOwner,
      };

      const message = `${queryMarker}: Recall the accepted Archivist launch fact for this workspace and return the request acknowledgement.`;
      await rpc('chat.send', {
        sessionKey: project.sessionKey,
        message,
        idempotencyKey: queryMarker,
      });
      await expect.poll(
        () => observedRequests.some(({ request }) =>
          roleText(request, ['user']).includes(queryMarker)),
        { timeout: 90_000 },
      ).toBe(true);
      await waitForAssistantText(
        () => rpc<History>('chat.history', {
          sessionKey: project.sessionKey,
          limit: 100,
        }),
        expectedAssistantReadback,
      );

      const observed = observedRequests.find(({ request }) =>
        roleText(request, ['user']).includes(queryMarker));
      if (!observed) throw new Error('The scripted provider saw no request for the TF-0582 chat turn');
      const systemText = roleText(observed.request, ['system']);
      expect(systemText).toContain('## Memory Context');
      expect(systemText).toContain(acceptedContent);
      expect(systemText).toContain(`ACCEPTED-MEMORY-${acceptedValue}`);
      expect(systemText).not.toContain(rejectedContent);
      expect(systemText).not.toContain(`REJECTED-MEMORY-${rejectedValue}`);
      expect(systemText).not.toContain(otherScopeContent);
      expect(systemText).not.toContain(`OTHER-SCOPE-MEMORY-${otherScopeValue}`);

      await expect.poll(async () => {
        const receipts = await rpc<{ injections?: MemoryInjectionReceipt[] }>(
          'memory.explainInjection',
          { sessionKey: project.sessionKey, roleName: 'main', limit: 20 },
        );
        return (receipts.injections ?? []).flatMap((injection) => injection.cardIds);
      }, { timeout: 30_000 }).toEqual(expect.arrayContaining([acceptedCardId]));

      const injectionReadback = await rpc<{
        injections?: MemoryInjectionReceipt[];
      }>('memory.explainInjection', {
        sessionKey: project.sessionKey,
        roleName: 'main',
        limit: 20,
      });
      const injection = (injectionReadback.injections ?? []).find(
        (candidate) => candidate.cardIds.includes(acceptedCardId),
      );
      if (!injection) {
        throw new Error('memory.explainInjection returned no receipt for the accepted card');
      }
      expect(injection.cardIds).toContain(acceptedCardId);
      expect(injection.cardIds).not.toContain(otherScopeCardId);

      const history = await rpc<History>('chat.history', {
        sessionKey: project.sessionKey,
        limit: 100,
      });
      expect(assistantTexts(history)).toContain(expectedAssistantReadback);

      evidence.positive = {
        proposal: acceptedCandidate.proposal,
        review: acceptedReview,
        owner: acceptedOwner,
        receipt: injection,
      };
      evidence.negatives = {
        rejectedProposal: rejectedReview,
        rejectedOwner,
        crossScopeReview: otherScopeReview,
        crossScopeOwner: otherScopeOwner,
      };
      evidence.request = observed.request;
      evidence.requestIndex = observed.requestIndex;
      evidence.systemText = systemText;
      evidence.history = history;
      evidence.opaques = {
        source: 'independent-random-uuid-v4-values',
        queryMarker,
        acceptedValue,
        rejectedValue,
        otherScopeValue,
        assistantAnswerSource: 'request-system-context-regex-extraction',
        expectedAssistantReadback,
      };
      evidence.assertions = {
        acceptedInSystemRequest: true,
        rejectedAbsentFromSystemRequest: true,
        crossScopeAbsentFromSystemRequest: true,
        acceptedInOwnerReceipt: true,
        assistantReadbackDerivedFromSystemRequest: true,
        assistantReadbackInHistory: true,
      };
      evidence.status = 'passed';
    } catch (error) {
      failure = error;
      evidence.status = 'failed';
      evidence.failure = error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error);
    } finally {
      if (app) {
        try {
          await hostInvoke(app, 'gateway', 'stop');
        } catch (error) {
          evidence.cleanupError = String(error);
          failure ??= error;
        } finally {
          try {
            await closeElectronApp(app);
          } catch (error) {
            evidence.cleanupError = String(error);
            failure ??= error;
          }
        }
      }
      llm.server.closeAllConnections();
      await new Promise<void>((resolve) => llm.server.close(() => resolve()));
      evidence.providerLog = llm.log;
      evidence.providerAnomalies = llm.anomalies;
      evidence.observedRequests = observedRequests;
      if (failure) evidence.status = 'failed';
      const evidencePath = testInfo.outputPath('product-matrix-memory-evidence.json');
      const serialized = JSON.stringify(evidence, null, 2) + '\n';
      await writeFile(evidencePath, serialized, 'utf8');
      await testInfo.attach('product-matrix-memory-evidence.json', {
        body: Buffer.from(serialized),
        contentType: 'application/json',
      });
    }

    if (failure) throw failure;
  });
});
