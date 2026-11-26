---
title: host-knowledge-scope / electron/services/chat-api.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-09T23:01:31.258Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: electron/services/chat-api.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { GatewayManager } from '../gateway/manager';
import { GatewayRpcError } from '../gateway/protocol';
import { normalizeRunScope } from '@shared/types/identity-scope';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { logger } from '../utils/logger';
import { handleMockChatSend } from './mock-provider';
import { isRecord } from './payload-utils';
import type { ChatKnowledgeDenial } from '../../shared/host-api/contract';
import { loadTaskLedgerSnapshot } from './task-ledger-service';
import { readTaskLedgerWorkingContext } from './task-ledger-working-context';
import { getResourceTracker } from './resource-tracker';
import { evaluateTurnBudget } from '../../shared/agent-resource-limits';
import { LONG_TASK_INPUT_MODES } from '../../shared/types/long-task-control';
import { getSessionTokenUsageSummary } from '../utils/token-usage';
import { computeWorkspaceFingerprint } from '@shared/workspace-fingerprint';
import { getPersistedCoordinatorBinding, getWorkspaceRootPathById, materializeCoordinatorSessionGeneration,
  beginWorkspaceHandoffSend, readWorkspaceHandoffOperation, updateWorkspaceHandoffOperation } from './workspaces-api';
import type { WorkspaceCoordinatorBinding } from '@shared/types/workspace';
import {
  buildLongSessionContinuityContext,
  renderLongSessionContinuityContext,
  type ContinuityCompressionInput,
  type LongSessionContinuityContextPack,
} from '../../shared/long-session-continuity';
import type { MemorySurfaceSnapshot } from '../../shared/types/memory';
import type { SessionEffectivePolicy } from '../../shared/types/session-effective-policy';
import { getSetting } from '../utils/store';
import { getHostDeadline } from '../utils/host-deadline-context';
import { persistentTaskChatContext } from './task-system-service';
import { normalizeChatKnowledgeReferences } from '../../openclaw_runtime/src/context-engine/chat-knowledge-intent';
import { prepareKnowledgeReadScope, assertKnowledgeReadScopeCurrent } from './knowledge-read-scope';

const VISION_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/webp',
]);

const CONTEXT_FRAGMENT_LIMITS = {
  taskLedgerMetadataChars: 4_000,
  continuityContextChars: 2_800,
  toolUiResponseContractChars: 2_000,
} as const;

type ChatSendWithMediaPayload = {
  sessionKey?: unknown;
  workspaceId?: unknown;
  message?: unknown;
  deliver?: unknown;
  idempotencyKey?: unknown;
  handoffOperationId?: unknown;
  expectedSessionGeneration?: unknown;
  media?: unknown;
  inputMode?: unknown;
  knowledgeScope?: unknown;
  knowledgeMode?: unknown;
  knowledgeReferences?: unknown;
  activeTaskNodeId?: unknown;
  /** Area 2 §3.2: turn-scoped model override. */
  modelRef?: unknown;
  reasoningEffort?: unknown;
  runtimeIntensity?: unknown;
};

type MediaPayload = {
  filePath?: unknown;
  mimeType?: unknown;
  fileName?: unknown;
};

function agentIdFromSessionKey(sessionKey: string): string | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const [, agentId] = sessionKey.split(':');
  return agentId || null;
}

function normalizeMedia(media: unknown): Array<{ filePath: string; mimeType: string; fileName: string }> {
  if (!Array.isArray(media)) return [];
  return media.flatMap((entry): Array<{ filePath: string; mimeType: string; fileName: string }> => {
    if (!isRecord(entry)) return [];
    const item = entry as MediaPayload;
    if (typeof item.filePath !== 'string' || !item.filePath) return [];
    return [{
      filePath: item.filePath,
      mimeType: typeof item.mimeType === 'string' && item.mimeType ? item.mimeType : 'application/octet-stream',
      fileName: typeof item.fileName === 'string' && item.fileName ? item.fileName : item.filePath.split(/[\\/]/).pop() || 'file',
    }];
  });
}

function normalizeKnowledgeScope(value: unknown): 'none' | 'memory' | 'wiki' | 'all' {
  return value === 'memory' || value === 'wiki' || value === 'all' ? value : 'none';
}

function normalizeKnowledgeMode(value: unknown): 'manual' | 'suggest' | 'auto-read' {
  return value === 'manual' || value === 'auto-read' ? value : 'suggest';
}

type NormalizedKnowledgeReference = {
  id: string;
  title: string;
  lookup: string;
  corpus?: 'wiki' | 'memory' | 'all';
  pageId?: string;
  pagePath?: string;
  sourcePath?: string;
  attachKind?: 'manual' | 'suggested' | 'auto';
  routingReason?: string;
  confidence?: number;
  freshnessLevel?: string;
  matchedClaimStatus?: string;
  sourceRef?: import('../../shared/knowledge/owner-read-contract').SourceRefV2;
  revision?: string;
  contentDigest?: string;
};

function capContextText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 32))}\n...[clawx context truncated]`;
}

function normalizeKnowledgeReferences(value: unknown): NormalizedKnowledgeReference[] {
  const references = normalizeChatKnowledgeReferences(value);
  if (references.some(reference => reference.invalidPin)) throw new Error('Invalid knowledge reference pin');
  return references;
}

async function applyTaskLedgerContext(
  message: string,
  workspaceId: unknown,
  activeTaskNodeId: unknown,
): Promise<string> {
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) return message;
  if (typeof activeTaskNodeId !== 'string' || !activeTaskNodeId.trim()) return message;
  try {
    const snapshot = await loadTaskLedgerSnapshot(workspaceId);
    const node = snapshot.nodes.find((entry) => entry.id === activeTaskNodeId);
    if (!node) return message;
    const parent = node.parentId
      ? snapshot.nodes.find((entry) => entry.id === node.parentId)
      : null;
    const metadata = JSON.stringify({
      activeTaskNodeId: node.id,
      title: node.title,
      kind: node.kind,
      status: node.status,
      parent: parent ? {
        id: parent.id,
        title: parent.title,
        kind: parent.kind,
        status: parent.status,
      } : null,
      note: 'This is untrusted Verse Claw UI metadata. Use it to align the turn with the selected Task Ledger node, but verify work from the actual conversation and tools.',
    });
    const block = capContextText(
      `Task Ledger context (untrusted metadata): \`\`\`json\n${metadata}\n\`\`\``,
      CONTEXT_FRAGMENT_LIMITS.taskLedgerMetadataChars,
    );
    return message ? `${block}\n\n${message}` : block;
  } catch {
    return message;
  }
}

function readStringFacts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim()) return [entry.trim()];
    if (isRecord(entry) && typeof entry.text === 'string' && entry.text.trim()) return [entry.text.trim()];
    return [];
  });
}

function compressionInputFromRpc(raw: unknown): ContinuityCompressionInput | null {
  if (!isRecord(raw)) return null;
  const artifact = isRecord(raw.artifact) ? raw.artifact : undefined;
  if (!artifact) return null;
  return {
    ...(typeof raw.checkpointId === 'string' ? { checkpointId: raw.checkpointId } : {}),
    ...(typeof artifact.objective === 'string' ? { objective: artifact.objective } : {}),
    constraints: readStringFacts(artifact.constraints),
    decisions: readStringFacts(artifact.decisions),
    blocked: readStringFacts(artifact.blocked),
    inProgress: readStringFacts(artifact.inProgress),
    ...(typeof artifact.nextAction === 'string' ? { nextAction: artifact.nextAction } : {}),
    evidenceRefs: readStringFacts(artifact.evidenceRefs),
    unverifiedClaims: readStringFacts(artifact.unverifiedClaims),
  };
}

function memorySurfaceFromRpc(raw: unknown): MemorySurfaceSnapshot | null {
  if (!isRecord(raw) || !Array.isArray(raw.accepted) || !Array.isArray(raw.candidates) || !isRecord(raw.counts)) {
    return null;
  }
  return raw as unknown as MemorySurfaceSnapshot;
}

type LongSessionContinuityRead = {
  validation: 'current' | 'missing' | 'invalidated' | 'unavailable';
  pack?: LongSessionContinuityContextPack;
  rendered?: string;
  reason?: string;
};

async function readLongSessionContinuityContext(input: {
  gatewayManager: GatewayManager;
  sessionKey: string;
  workspaceId: string;
  activeTaskNodeId?: string;
  knowledgeReferences: NormalizedKnowledgeReference[];
}): Promise<LongSessionContinuityRead> {
  if (!input.workspaceId || !input.sessionKey) {
    return { validation: 'missing', reason: 'sessionKey and workspaceId are required' };
  }
  try {
    const binding = await getPersistedCoordinatorBinding(input.workspaceId, input.sessionKey);
    if (!binding) return { validation: 'missing', reason: 'no coordinator binding for this session' };
    if (binding.state === 'invalid') {
      return { validation: 'invalidated', reason: binding.invalidationReason ?? 'coordinator binding invalid' };
    }
    if (binding.state !== 'active') {
      return { validation: 'missing', reason: `coordinator binding is ${binding.state}` };
    }
    if (binding.agentId !== agentIdFromSessionKey(input.sessionKey)) {
      return { validation: 'missing', reason: 'coordinator binding targets a different agent' };
    }
    if (binding.sessionGeneration) {
      try {
        const described = await input.gatewayManager.rpc<{ session?: { sessionId?: string } | null }>(
          'sessions.describe',
          { key: input.sessionKey },
          15_000,
        );
        const liveGeneration = described?.session?.sessionId;
        if (!liveGeneration) return { validation: 'invalidated', reason: 'session_missing' };
        if (liveGeneration !== binding.sessionGeneration) {
          return { validation: 'invalidated', reason: 'generation_mismatch' };
        }
      } catch (error) {
        return {
          validation: 'unavailable',
          reason: `session owner unavailable: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    const workspaceRootPath = binding.environment.canonicalRoot;
    const roleMemoryEnabled = (await getSetting('roleMemoryEnabled')) !== false;
    const [ledgerResult, workingContextResult, compressionResult, memoryResult, policyResult] = await Promise.allSettled([
      loadTaskLedgerSnapshot(input.workspaceId),
      readTaskLedgerWorkingContext(input.workspaceId),
      input.gatewayManager.rpc('sessions.compressionArtifact', { key: input.sessionKey }, 10_000),
      input.gatewayManager.rpc('memory.surface', { limit: 100 }, 15_000),
      input.gatewayManager.rpc<{ snapshot?: { policy?: SessionEffectivePolicy }; result?: { policy?: SessionEffectivePolicy } }>(
        'session.activitySnapshot',
        { workspaceId: input.workspaceId, sessionKey: input.sessionKey },
        15_000,
      ),
    ]);
    const compression = compressionResult.status === 'fulfilled'
      ? compressionInputFromRpc(compressionResult.value)
      : null;
    const memorySurface = memoryResult.status === 'fulfilled'
      ? memorySurfaceFromRpc(memoryResult.value)
      : null;
    const policyEnvelope = policyResult.status === 'fulfilled' ? policyResult.value : undefined;
    const policy = policyEnvelope?.snapshot?.policy ?? (isRecord(policyEnvelope) && isRecord(policyEnvelope.result) ? (policyEnvelope.result as { policy?: SessionEffectivePolicy }).policy : undefined);
    const nativeBackendOwnsCompaction = policy?.backend.effective.value?.ownsNativeCompaction === true;
    const agentId = agentIdFromSessionKey(input.sessionKey) ?? binding.agentId;
    const pack = buildLongSessionContinuityContext({
      sessionKey: input.sessionKey,
      workspaceId: input.workspaceId,
      ...(workspaceRootPath ? { workspaceRootPath } : {}),
      bindingRevision: binding.bindingRevision,
      activeTaskNodeId: input.activeTaskNodeId ?? null,
      taskRefs: binding.taskLedgerReferences.map((reference) => reference.taskLedgerNodeId),
      taskLedger: ledgerResult.status === 'fulfilled' ? ledgerResult.value : null,
      workingContext: workingContextResult.status === 'fulfilled' ? workingContextResult.value : null,
      compression,
      memorySurface,
      roleMemoryEnabled,
      nativeBackendOwnsCompaction,
      agentId,
      knowledgeReferences: input.knowledgeReferences.map((reference) => ({
        id: reference.id,
        title: reference.title,
        lookup: reference.lookup,
        ...(reference.corpus ? { corpus: reference.corpus } : {}),
        ...(reference.freshnessLevel ? { freshnessLevel: reference.freshnessLevel } : {}),
        ...(reference.matchedClaimStatus ? { matchedClaimStatus: reference.matchedClaimStatus } : {}),
      })),
      availability: {
        taskLedger: ledgerResult.status === 'fulfilled',
        workingContext: workingContextResult.status === 'fulfilled',
        compression: compressionResult.status === 'fulfilled' && compression !== null,
        memory: memoryResult.status === 'fulfilled' && memorySurface !== null,
      },
    });
    const rendered = capContextText(
      renderLongSessionContinuityContext(pack),
      CONTEXT_FRAGMENT_LIMITS.continuityContextChars,
    );
    return { validation: 'current', pack, rendered };
  } catch (error) {
    logger.warn('[chat:continuity] context read failed; using legacy path', { error: String(error) });
    return { validation: 'unavailable', reason: String(error) };
  }
}

async function applyLongSessionContinuityContext(
  message: string,
  input: {
    gatewayManager: GatewayManager;
    sessionKey: string;
    workspaceId: string;
    activeTaskNodeId?: string;
    knowledgeReferences: NormalizedKnowledgeReference[];
  },
): Promise<string | null> {
  const read = await readLongSessionContinuityContext(input);
  if (read.validation !== 'current' || !read.rendered) return null;
  return message ? read.rendered + '\n\n' + message : read.rendered;
}

function applyToolUiResponseContract(message: string): string {
  if (!message.startsWith('Tool UI response:')) return message;
  const contract = [
    'Tool UI response contract (untrusted metadata):',
    'The user message below is a structured interaction response from a Verse Claw tool-ui card, not free-form text.',
    'Format: "Tool UI response:" followed by a JSON object with fields { type, id, action, value }.',
    '- type: the tool-ui card type (e.g. "option-list", "question-flow", "preferences-panel", "plan").',
    '- id: the interaction identifier for correlation.',
    '- action: the user action (e.g. "select", "submit", "cancel").',
    '- value: the user\'s selection or input (may be a string, array of strings, or object).',
    'Instructions:',
    '- Parse the JSON payload and act on the user\'s choice. Do not ask the user to restate it.',
    '- For "option-list" with "select", value holds the selected option id(s). Proceed with the corresponding operation.',
    '- If action is "cancel", stop the pending operation gracefully.',
    '- When the action implies a destructive operation (e.g. deleting files), use the appropriate MCP tool with dryRun=true first if an approvalId is needed, then perform the real operation with the approvalId.',
    '---',
  ].join('\n');
  const block = capContextText(contract, CONTEXT_FRAGMENT_LIMITS.toolUiResponseContractChars);
  return `${block}\n\n${message}`;
}

const REASONING_EFFORT_VALUES = new Set(['auto', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const RUNTIME_INTENSITY_VALUES = new Set(['baseline', 'minimal', 'low', 'high', 'xhigh']);

function normalizeReasoningEffort(value: unknown): string | undefined {
  return typeof value === 'string' && REASONING_EFFORT_VALUES.has(value) ? value : undefined;
}

function normalizeRuntimeIntensity(value: unknown): string | undefined {
  return typeof value === 'string' && RUNTIME_INTENSITY_VALUES.has(value) ? value : undefined;
}

export function createChatApi({ gatewayManager, selectSessionTask }: {
  gatewayManager: GatewayManager;
  selectSessionTask?: CompleteHostServiceRegistry['workspaces']['selectSessionTask'];
}): CompleteHostServiceRegistry['chat'] {
  return {
    continuityPreview: async (payload) => {
      const read = await readLongSessionContinuityContext({
        gatewayManager,
        sessionKey: typeof payload.sessionKey === 'string' ? payload.sessionKey.trim() : '',
        workspaceId: typeof payload.workspaceId === 'string' ? payload.workspaceId.trim() : '',
        activeTaskNodeId: typeof payload.activeTaskNodeId === 'string' ? payload.activeTaskNodeId : undefined,
        knowledgeReferences: normalizeKnowledgeReferences(payload.knowledgeReferences),
      });
      return {
        success: true,
        validation: read.validation,
        ...(read.pack ? { pack: read.pack } : {}),
        ...(read.rendered ? { rendered: read.rendered } : {}),
        ...(read.reason ? { reason: read.reason } : {}),
      };
    },
    sendWithMedia: async (payload) => {
      const body = isRecord(payload) ? payload as ChatSendWithMediaPayload : {};
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey : '';
      const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
      if (!sessionKey || !idempotencyKey) {
        return { success: false, error: 'Invalid chat send payload' };
      }
      const requestedReasoningEffort =
        body.reasoningEffort === undefined
          ? undefined
          : normalizeReasoningEffort(body.reasoningEffort);
      const requestedRuntimeIntensity =
        body.runtimeIntensity === undefined
          ? undefined
          : normalizeRuntimeIntensity(body.runtimeIntensity);
      if (
        (body.reasoningEffort !== undefined && requestedReasoningEffort === undefined) ||
        (body.runtimeIntensity !== undefined && requestedRuntimeIntensity === undefined)
      ) {
        return { success: false, error: 'Invalid reasoning effort or runtime intensity' };
      }

      try {
        if (typeof body.activeTaskNodeId === 'string' && body.activeTaskNodeId.trim()) {
          const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '';
          if (!workspaceId) throw new Error('TASK_SCOPE_WORKSPACE_UNAVAILABLE');
          const binding = await getPersistedCoordinatorBinding(workspaceId, sessionKey);
          const selected = binding?.activeTaskNodeId ?? (binding?.taskLedgerReferences.length === 1 ? binding.taskLedgerReferences[0].taskLedgerNodeId : null);
          if (selected !== body.activeTaskNodeId) {
            if (!selectSessionTask) throw new Error('TASK_SCOPE_SELECTION_OWNER_UNAVAILABLE');
            await selectSessionTask({ workspaceId, sessionKey, taskNodeId: body.activeTaskNodeId,
              expectedSessionGeneration: typeof body.expectedSessionGeneration === 'string' ? body.expectedSessionGeneration : undefined,
              expectedRevision: binding?.bindingRevision ?? 0,
            });
          }
        }
        if (typeof body.expectedSessionGeneration === 'string') {
          const current = await gatewayManager.rpc<{ session?: { sessionId?: string } }>('sessions.describe', { key: sessionKey }, 15_000);
          if (current.session?.sessionId !== body.expectedSessionGeneration) return { success: false, error: 'CHAT_SESSION_GENERATION_CHANGED' };
        }
        const usage = await getSessionTokenUsageSummary(sessionKey);
        const budget = evaluateTurnBudget({
          totalTokens: usage.totalTokens,
          costUsd: usage.estimatedCostUsd,
        });
        if (!budget.allowed && budget.code !== 'TURN_TIMEOUT') {
          logger.warn(
            `[chat:sendWithMedia] Rejected before Gateway send: code=${budget.code} sessionKey=${sessionKey} used=${budget.used} limit=${budget.limit}`,
          );
          return {
            success: false,
            error: budget.code,
            denial: {
              code: budget.code,
              limit: budget.limit,
              used: budget.used,
            },
          };
        }

        const earlyMockResult = body.handoffOperationId ? null : handleMockChatSend({
          sessionKey,
          message: typeof body.message === 'string' ? body.message : '',
          deliver: body.deliver ?? false,
          idempotencyKey,
        });
        if (earlyMockResult) {
          logger.info('[chat:sendWithMedia] Mock provider response');
          return { success: true, result: earlyMockResult };
        }

        const knowledgeScope = normalizeKnowledgeScope(body.knowledgeScope);
        const knowledgeMode = normalizeKnowledgeMode(body.knowledgeMode);
        const knowledgeReferences = normalizeKnowledgeReferences(body.knowledgeReferences);
        const knowledgeReadScope = knowledgeReferences.length ? await prepareKnowledgeReadScope(gatewayManager, {
          sessionKey, workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
        }) : undefined;
        if (knowledgeReadScope?.expectedSessionGeneration && typeof body.expectedSessionGeneration === 'string'
          && body.expectedSessionGeneration !== knowledgeReadScope.expectedSessionGeneration) throw new Error('Knowledge session generation changed');
        let message = applyToolUiResponseContract(typeof body.message === 'string' ? body.message : '');
        const continuityMessage = await applyLongSessionContinuityContext(message, {
          gatewayManager,
          sessionKey,
          workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '',
          activeTaskNodeId: typeof body.activeTaskNodeId === 'string' ? body.activeTaskNodeId : undefined,
          knowledgeReferences,
        });
        message = continuityMessage ?? await applyTaskLedgerContext(message, body.workspaceId, body.activeTaskNodeId);
        const imageAttachments: Array<Record<string, unknown>> = [];
        const fileReferences: string[] = [];
        const media = normalizeMedia(body.media);

        if (media.length > 0) {
          const fsP = await import('node:fs/promises');
          for (const item of media) {
            const exists = await fsP.access(item.filePath).then(() => true, () => false);
            logger.info(
              `[chat:sendWithMedia] Processing file: ${item.fileName} (${item.mimeType}), path: ${item.filePath}, exists: ${exists}, isVision: ${VISION_MIME_TYPES.has(item.mimeType)}`,
            );

            fileReferences.push(
              `[media attached: ${item.filePath} (${item.mimeType}) | ${item.filePath}]`,
            );

            if (VISION_MIME_TYPES.has(item.mimeType)) {
              const fileBuffer = await fsP.readFile(item.filePath);
              const base64Data = fileBuffer.toString('base64');
              logger.info(`[chat:sendWithMedia] Read ${fileBuffer.length} bytes, base64 length: ${base64Data.length}`);
              imageAttachments.push({
                content: base64Data,
                mimeType: item.mimeType,
                fileName: item.fileName,
              });
            }
          }
        }

        if (fileReferences.length > 0) {
          const refs = fileReferences.join('\n');
          message = message ? `${message}\n\n${refs}` : refs;
        }

        const rpcParams: Record<string, unknown> = {
          sessionKey,
          message,
          deliver: body.deliver ?? false,
          idempotencyKey,
          ...(typeof body.expectedSessionGeneration === 'string' ? { expectedSessionGeneration: body.expectedSessionGeneration } : {}),
        };
        // D3 closeout: forward `workspaceId` and a trusted `workspaceFingerprint`
        // produced from the workspace's normalized rootPath. Gateway uses the
        // fingerprint as the workspace authority field; embedded attempt binds
        // the same fingerprint via `bindSessionWorkspaceFingerprint` so mismatch
        // invalidates `working-memory:${sessionId}` consistently across the
        // Chat→Main→Gateway chain. When rootPath lookup fails, workspaceId is
        // still forwarded for Task Ledger continuity, but no fingerprint is
        // produced (agent-config fallback path, no false invalidation).
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '';
        let pendingCoordinatorBinding: WorkspaceCoordinatorBinding | null = null;
        if (workspaceId) {
          rpcParams.workspaceId = workspaceId;
          const coordinatorBinding = await getPersistedCoordinatorBinding(workspaceId, sessionKey);
          let rootPath: string | undefined;
          if (coordinatorBinding) {
            if (coordinatorBinding.agentId !== agentIdFromSessionKey(sessionKey)) {
              throw new Error('COORDINATOR_AGENT_SCOPE_MISMATCH: The bound Assistant does not own this session.');
            }
            if (coordinatorBinding.state !== 'active') {
              throw new Error(`COORDINATOR_BINDING_${coordinatorBinding.state.toUpperCase()}: The long-session environment is not active.`);
            }
            try {
              await access(coordinatorBinding.environment.canonicalRoot);
            } catch {
              throw new Error('COORDINATOR_ENVIRONMENT_MISSING: The bound checkout or worktree is unavailable.');
            }
            if (coordinatorBinding.sessionGeneration) {
              const described = await gatewayManager.rpc<{ session?: { sessionId?: string } | null }>(
                'sessions.describe',
                { key: sessionKey },
                15_000,
              );
              if (!described?.session?.sessionId) {
                throw new Error('COORDINATOR_SESSION_MISSING: The bound session generation is unavailable.');
              }
              if (described.session.sessionId !== coordinatorBinding.sessionGeneration) {
                throw new Error('COORDINATOR_GENERATION_MISMATCH: The session was reset after the coordinator binding was created.');
              }
            } else {
              pendingCoordinatorBinding = coordinatorBinding;
            }
            rootPath = coordinatorBinding.environment.canonicalRoot;
          } else {
            rootPath = await getWorkspaceRootPathById(workspaceId);
          }
          if (rootPath) {
            rpcParams.workspaceDir = rootPath;
            const workspaceFingerprint = computeWorkspaceFingerprint(rootPath);
            if (workspaceFingerprint) {
              rpcParams.workspaceFingerprint = workspaceFingerprint;
            }
          }
        }
        if (
          typeof body.inputMode === 'string' &&
          (LONG_TASK_INPUT_MODES as readonly string[]).includes(body.inputMode)
        ) {
          rpcParams.inputMode = body.inputMode;
        }
        if (workspaceId) {
          // Validate ownership here; the runtime restores task context at the provider boundary.
          // Keep the user's message byte-for-byte intact in the visible transcript.
          await persistentTaskChatContext(workspaceId,sessionKey,gatewayManager,typeof rpcParams.workspaceDir==='string'?rpcParams.workspaceDir:undefined);
        }
        // KS-04: renderer refs are untrusted retrieval intent. Main forwards
        // typed refs only; runtime resolves them through DCS owner adapters.
        if (knowledgeScope !== 'none' || knowledgeReferences.length > 0) {
          rpcParams.knowledgeScope = knowledgeScope;
          rpcParams.knowledgeMode = knowledgeMode;
          if (knowledgeReferences.length > 0) {
            rpcParams.knowledgeReferences = knowledgeReferences;
          }
        }
        if (knowledgeReadScope) {
          await assertKnowledgeReadScopeCurrent(gatewayManager, knowledgeReadScope);
          if (knowledgeReadScope.expectedSessionGeneration) rpcParams.expectedSessionGeneration = knowledgeReadScope.expectedSessionGeneration;
          rpcParams.workspaceId = knowledgeReadScope.identity.workspaceId;
          rpcParams.workspaceDir = knowledgeReadScope.identity.workspaceDir;
          rpcParams.workspaceFingerprint = computeWorkspaceFingerprint(knowledgeReadScope.identity.workspaceDir ?? '');
        }
        // Area 2 §3.2: forward turn-scoped model override to runtime chat.send.
        // Empty/null means "no turn override" — omit so resolution falls through.
        if (typeof body.modelRef === 'string' && body.modelRef.trim()) {
          rpcParams.model = body.modelRef.trim();
        }
        if (requestedReasoningEffort) {
          rpcParams.reasoningEffort = requestedReasoningEffort;
        }
        if (requestedRuntimeIntensity) {
          rpcParams.runtimeIntensity = requestedRuntimeIntensity;
        }
        if (imageAttachments.length > 0) {
          rpcParams.attachments = imageAttachments;
        }
        // NET-E (TF-0442): forward the renderer's logical deadline so the gateway
        // clamps its turn watchdog and the provider request timeout to what
        // remains instead of starting a fresh window per layer.
        const hostDeadline = getHostDeadline();
        if (hostDeadline) {
          rpcParams.deadlineAtMs = hostDeadline.deadlineAtMs;
        }

        const tracker = getResourceTracker();
        tracker.markSessionActive(sessionKey);
        const portBaseline = await tracker.scanListeningPorts().catch(() => []);

        logger.info(
          `[chat:sendWithMedia] Sending: message="${message.substring(0, 100)}", attachments=${imageAttachments.length}, fileRefs=${fileReferences.length}`,
        );
        // The host action carries a bounded logical deadline (15 minutes for a
        // real chat turn); use that same budget here instead of a second fixed
        // 120s ceiling that would cancel a valid multi-tool turn early.
        const handoffOperationId = typeof body.handoffOperationId === 'string' ? body.handoffOperationId : undefined;
        if (handoffOperationId) {
          const operation = await readWorkspaceHandoffOperation({ workspaceId, sessionKey, operationId: handoffOperationId });
          const described = await gatewayManager.rpc<{ session?: { sessionId?: string } }>('sessions.describe', { key: sessionKey }, 15_000);
          if (!operation?.sessionGeneration || operation.sessionGeneration !== described.session?.sessionId) throw new Error('HANDOFF_CHILD_GENERATION_CHANGED');
          rpcParams.expectedSessionGeneration = operation.sessionGeneration;
          const admitted = await beginWorkspaceHandoffSend({ workspaceId, sessionKey, operationId: handoffOperationId,
            idempotencyKey, draftInput: typeof body.message === 'string' ? body.message : '',
            requestDigest: createHash('sha256').update(JSON.stringify({ ...rpcParams, deadlineAtMs: undefined })).digest('hex') });
          if (admitted.receipt && ['accepted', 'sent'].includes(admitted.phase)) {
            return { success: true, result: { runId: admitted.receipt.run.runId } };
          }
        }
        let result: unknown;
        try {
          if (knowledgeReadScope) await assertKnowledgeReadScopeCurrent(gatewayManager, knowledgeReadScope);
          result = await gatewayManager.rpc('chat.send', rpcParams, 15 * 60_000);
          if (handoffOperationId) {
            if (!isRecord(result) || result.runId !== idempotencyKey) throw new Error('HANDOFF_SEND_IDENTITY_UNCONFIRMED');
            await updateWorkspaceHandoffOperation(workspaceId, handoffOperationId, (current) => ({
              ...current!, phase: current!.phase === 'sent' ? 'sent' : 'accepted', error: null,
              receipt: { source: 'gateway-ack', run: normalizeRunScope({ runId: idempotencyKey, scope: { workspaceId, sessionKey } }) },
            }));
          }
        } catch (error) {
          if (handoffOperationId) await updateWorkspaceHandoffOperation(workspaceId, handoffOperationId, (current) => ({
            ...current!, phase: current!.phase === 'sent' ? 'sent'
              : error instanceof GatewayRpcError && ['INVALID_REQUEST', '-32600', '-32602'].includes(String(error.payload.code)) ? 'failed' : 'unknown',
            error: String(error),
          }));
          throw error;
        }
        if (pendingCoordinatorBinding && workspaceId) {
          try {
            const described = await gatewayManager.rpc<{ session?: { sessionId?: string } | null }>(
              'sessions.describe',
              { key: sessionKey },
              15_000,
            );
            if (described?.session?.sessionId) {
              await materializeCoordinatorSessionGeneration({
                workspaceId,
                sessionKey,
                sessionId: described.session.sessionId,
              });
            }
          } catch (error) {
            logger.warn('[chat:sendWithMedia] coordinator generation materialization delayed', {
              sessionKey,
              error: String(error),
            });
          }
        }
        tracker.watchNewListeningPorts({
          before: portBaseline,
          sessionKey,
          sessionLabel: sessionKey,
          workspaceId: typeof body.workspaceId === 'string' && body.workspaceId.trim() ? body.workspaceId : null,
          agentId: agentIdFromSessionKey(sessionKey),
          labelPrefix: 'Session server',
        });
        logger.info(`[chat:sendWithMedia] RPC result: ${JSON.stringify(result)}`);
        const response = isRecord(result) && typeof result.runId === 'string'
          ? { runId: result.runId }
          : undefined;
        const knowledgeDenials = isRecord(result) && Array.isArray(result.knowledgeDenials)
          ? result.knowledgeDenials
              .filter((entry): entry is ChatKnowledgeDenial =>
                isRecord(entry) &&
                typeof entry.id === 'string' &&
                typeof entry.title === 'string' &&
                typeof entry.lookup === 'string' &&
                typeof entry.reason === 'string' &&
                typeof entry.visibleReason === 'string')
          : [];
        return {
          success: true,
          ...(response ? { result: response } : {}),
          ...(knowledgeDenials.length > 0 ? { knowledgeDenials } : {}),
          ...(isRecord(result) && Array.isArray(result.knowledgeReferences) ? { knowledgeReferences: normalizeKnowledgeReferences(result.knowledgeReferences) } : {}),
        };
      } catch (error) {
        logger.error(`[chat:sendWithMedia] Error: ${String(error)}`);
        return { success: false, error: String(error) };
      }
    },
  };
}

~~~
