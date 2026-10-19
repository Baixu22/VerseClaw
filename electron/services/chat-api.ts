import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { logger } from '../utils/logger';
import { handleMockChatSend } from './mock-provider';
import { isRecord } from './payload-utils';
import type { ChatKnowledgeDenial } from '../../shared/host-api/contract';
import { loadTaskLedgerSnapshot } from './task-ledger-service';
import { getResourceTracker } from './resource-tracker';
import { evaluateTurnBudget } from '../../shared/agent-resource-limits';
import { LONG_TASK_INPUT_MODES } from '../../shared/types/long-task-control';
import { getSessionTokenUsageSummary } from '../utils/token-usage';
import { computeWorkspaceFingerprint } from '@shared/workspace-fingerprint';
import { getWorkspaceRootPathById } from './workspaces-api';
import { getHostDeadline } from '../utils/host-deadline-context';

const VISION_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/webp',
]);

const CONTEXT_FRAGMENT_LIMITS = {
  taskLedgerMetadataChars: 4_000,
  toolUiResponseContractChars: 2_000,
} as const;

type ChatSendWithMediaPayload = {
  sessionKey?: unknown;
  workspaceId?: unknown;
  message?: unknown;
  deliver?: unknown;
  idempotencyKey?: unknown;
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
};

function capContextText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 32))}\n...[clawx context truncated]`;
}

function normalizeKnowledgeReferences(value: unknown): NormalizedKnowledgeReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): NormalizedKnowledgeReference[] => {
    if (!isRecord(entry)) return [];
    const lookup = typeof entry.lookup === 'string' ? entry.lookup.trim() : '';
    if (!lookup) return [];
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : lookup;
    const title = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : lookup;
    const corpus = entry.corpus === 'memory' || entry.corpus === 'all' || entry.corpus === 'wiki' ? entry.corpus : undefined;
    const pageId = typeof entry.pageId === 'string' && entry.pageId.trim() ? entry.pageId.trim() : undefined;
    const pagePath = typeof entry.pagePath === 'string' && entry.pagePath.trim() ? entry.pagePath.trim() : undefined;
    const sourcePath = typeof entry.sourcePath === 'string' && entry.sourcePath.trim() ? entry.sourcePath.trim() : undefined;
    const attachKind = entry.attachKind === 'suggested' || entry.attachKind === 'auto' ? entry.attachKind : entry.attachKind === 'manual' ? 'manual' : undefined;
    const routingReason = typeof entry.routingReason === 'string' && entry.routingReason.trim() ? entry.routingReason.trim() : undefined;
    const confidence = typeof entry.confidence === 'number' && Number.isFinite(entry.confidence) ? entry.confidence : undefined;
    const freshnessLevel = typeof entry.freshnessLevel === 'string' && entry.freshnessLevel.trim() ? entry.freshnessLevel.trim() : undefined;
    const matchedClaimStatus = typeof entry.matchedClaimStatus === 'string' && entry.matchedClaimStatus.trim() ? entry.matchedClaimStatus.trim() : undefined;
    return [{
      id,
      title,
      lookup,
      ...(corpus ? { corpus } : {}),
      ...(pageId ? { pageId } : {}),
      ...(pagePath ? { pagePath } : {}),
      ...(sourcePath ? { sourcePath } : {}),
      ...(attachKind ? { attachKind } : {}),
      ...(routingReason ? { routingReason } : {}),
      ...(typeof confidence === 'number' ? { confidence } : {}),
      ...(freshnessLevel ? { freshnessLevel } : {}),
      ...(matchedClaimStatus ? { matchedClaimStatus } : {}),
    }];
  }).slice(0, 8);
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

export function createChatApi({ gatewayManager }: { gatewayManager: GatewayManager }): CompleteHostServiceRegistry['chat'] {
  return {
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

        const earlyMockResult = handleMockChatSend({
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
        let message = applyToolUiResponseContract(typeof body.message === 'string' ? body.message : '');
        message = await applyTaskLedgerContext(message, body.workspaceId, body.activeTaskNodeId);
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
        if (workspaceId) {
          rpcParams.workspaceId = workspaceId;
          const rootPath = await getWorkspaceRootPathById(workspaceId);
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
        // KS-04: renderer refs are untrusted retrieval intent. Main forwards
        // typed refs only; runtime resolves them through DCS owner adapters.
        if (knowledgeScope !== 'none' || knowledgeReferences.length > 0) {
          rpcParams.knowledgeScope = knowledgeScope;
          rpcParams.knowledgeMode = knowledgeMode;
          if (knowledgeReferences.length > 0) {
            rpcParams.knowledgeReferences = knowledgeReferences;
          }
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
        const result = await gatewayManager.rpc('chat.send', rpcParams, 120000);
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
        };
      } catch (error) {
        logger.error(`[chat:sendWithMedia] Error: ${String(error)}`);
        return { success: false, error: String(error) };
      }
    },
  };
}
