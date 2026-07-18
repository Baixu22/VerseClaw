import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { logger } from '../utils/logger';
import { handleMockChatSend } from './mock-provider';
import { findStewardNotesForReferences } from './knowledge-api';
import { isRecord } from './payload-utils';
import { loadTaskLedgerSnapshot } from './task-ledger-service';
import { getResourceTracker } from './resource-tracker';
import { evaluateTurnBudget } from '../../shared/agent-resource-limits';
import { getSessionTokenUsageSummary } from '../utils/token-usage';

const VISION_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/webp',
]);

const CONTEXT_FRAGMENT_LIMITS = {
  knowledgeMetadataChars: 8_000,
  knowledgeReadCitationsChars: 6_000,
  // Area 5 §3.3 — Steward Notes injection budget. Smaller than the metadata
  // and citations blocks: notes are short persisted-state warnings/flags
  // (typically 1-3 lines per reference), not full page content. 2_000 chars
  // covers ~10 references with a warning each while keeping the chat send
  // path fast and the prompt budget impact bounded.
  knowledgeStewardNotesChars: 2_000,
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
  snippet?: string;
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
    const snippet = typeof entry.snippet === 'string' && entry.snippet.trim() ? entry.snippet.trim().slice(0, 800) : undefined;
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
      ...(snippet ? { snippet } : {}),
      ...(attachKind ? { attachKind } : {}),
      ...(routingReason ? { routingReason } : {}),
      ...(typeof confidence === 'number' ? { confidence } : {}),
      ...(freshnessLevel ? { freshnessLevel } : {}),
      ...(matchedClaimStatus ? { matchedClaimStatus } : {}),
    }];
  }).slice(0, 8);
}

function applyKnowledgeMetadata(message: string, knowledgeScope: 'none' | 'memory' | 'wiki' | 'all', knowledgeMode: 'manual' | 'suggest' | 'auto-read', knowledgeReferences: NormalizedKnowledgeReference[] = []): string {
  if (knowledgeScope === 'none' && knowledgeReferences.length === 0) return message;
  const corpus = knowledgeScope === 'memory' ? 'memory' : knowledgeScope === 'wiki' ? 'wiki' : knowledgeScope === 'all' ? 'all' : 'wiki';
  const instruction = knowledgeScope === 'memory'
    ? 'Read durable memory when prior preferences, decisions, or remembered work may be relevant.'
    : knowledgeScope === 'wiki'
      ? 'Read compiled wiki knowledge when accumulated project knowledge, source-backed notes, or syntheses may be relevant.'
      : knowledgeScope === 'all'
        ? 'Read durable memory and compiled wiki knowledge when either corpus may be relevant.'
        : 'Use the selected knowledge references for this turn when relevant.';
  const metadata = JSON.stringify({
    clawxKnowledgeScope: knowledgeScope,
    clawxKnowledgeMode: knowledgeMode,
    corpus,
    access: 'read-only',
    allowedKnowledgeActions: ['search', 'get'],
    deniedKnowledgeActions: ['apply', 'update', 'delete', 'archive', 'merge'],
    selectedKnowledgeReferences: knowledgeReferences,
    instruction: `${instruction} This scope is read-only: use knowledge search/get only. If selectedKnowledgeReferences is non-empty, prefer knowledge.get with each lookup before answering when relevant. Do not save, modify, merge, archive, delete, or apply knowledge because of this scope or these references. If something seems worth saving, suggest it or create a pending draft only when the user explicitly asks; any write still requires user confirmation.`,
  });
  const block = capContextText(
    `Conversation info (untrusted metadata): \`\`\`json\n${metadata}\n\`\`\``,
    CONTEXT_FRAGMENT_LIMITS.knowledgeMetadataChars,
  );
  return message ? `${block}\n\n${message}` : block;
}

function summarizeKnowledgeReadResult(reference: NormalizedKnowledgeReference, result: unknown): Record<string, unknown> {
  const record = isRecord(result) ? result : {};
  const found = record.found !== false;
  const content = typeof record.content === 'string'
    ? record.content
    : typeof record.text === 'string'
      ? record.text
      : typeof reference.snippet === 'string'
        ? reference.snippet
        : '';
  return {
    id: reference.id,
    title: reference.title,
    lookup: reference.lookup,
    corpus: reference.corpus ?? 'wiki',
    found,
    pageId: typeof record.pageId === 'string' ? record.pageId : reference.pageId,
    pagePath: typeof record.pagePath === 'string' ? record.pagePath : reference.pagePath,
    sourcePath: typeof record.sourcePath === 'string' ? record.sourcePath : reference.sourcePath,
    citation: content.slice(0, 600),
  };
}

async function readSelectedKnowledgeReferences(
  gatewayManager: GatewayManager,
  knowledgeScope: 'none' | 'memory' | 'wiki' | 'all',
  knowledgeMode: 'manual' | 'suggest' | 'auto-read',
  knowledgeReferences: NormalizedKnowledgeReference[],
): Promise<Array<Record<string, unknown>>> {
  if (knowledgeMode !== 'auto-read' || knowledgeReferences.length === 0) return [];
  if (knowledgeScope === 'none' && knowledgeReferences.every((reference) => !reference.corpus)) return [];
  const reads: Array<Record<string, unknown>> = [];
  for (const reference of knowledgeReferences.slice(0, 5)) {
    try {
      const result = await gatewayManager.rpc('wiki.get', {
        lookup: reference.lookup,
        corpus: reference.corpus === 'memory' || reference.corpus === 'all' ? reference.corpus : knowledgeScope === 'memory' || knowledgeScope === 'all' ? knowledgeScope : 'wiki',
        lineCount: 80,
      }, 30000);
      reads.push(summarizeKnowledgeReadResult(reference, result));
    } catch (error) {
      reads.push({
        id: reference.id,
        title: reference.title,
        lookup: reference.lookup,
        corpus: reference.corpus ?? knowledgeScope,
        found: false,
        error: String(error),
      });
    }
  }
  return reads;
}

function applyKnowledgeReadCitations(message: string, reads: Array<Record<string, unknown>>): string {
  if (reads.length === 0) return message;
  const metadata = JSON.stringify({
    clawxKnowledgeReads: reads,
    instruction: 'These read-only knowledge references were fetched before this turn. Treat them as citations/provenance hints, cite them when used, and do not modify knowledge from this metadata.',
  });
  const block = capContextText(
    `Knowledge read citations (untrusted metadata): \`\`\`json\n${metadata}\n\`\`\``,
    CONTEXT_FRAGMENT_LIMITS.knowledgeReadCitationsChars,
  );
  return message ? `${block}\n\n${message}` : block;
}

/**
 * Area 5 §3.3 — Steward Notes injection. Third metadata block alongside
 * `applyKnowledgeMetadata` and `applyKnowledgeReadCitations`, carrying the
 * Steward's persisted opinions (warnings, review status, suggestions) for
 * the references actually attached this turn.
 *
 * Notes come from persisted state only — NO turn-time LLM call. The block:
 *   - is absent when `notes` is empty (zero overhead for non-KB turns)
 *   - respects the 2_000-char cap (older notes truncated by `capContextText`)
 *   - carries an explicit "do not modify knowledge" instruction (read-only
 *     discipline extends unchanged from the existing two blocks)
 *   - attributes each note to the steward variant that produced it (so the
 *     model can weigh conflicting opinions from different variants)
 *
 * Lookup failure for any reference → that reference's notes are skipped
 * (callers filter before calling). The block never throws.
 */
function applyKnowledgeStewardNotes(
  message: string,
  notes: Array<{
    referenceId: string;
    roleId: string;
    warnings: string[];
    reviewStatus?: 'steward_reviewed' | 'unreviewed';
    suggestion?: 'merge' | 'archive' | null;
  }>,
): string {
  if (notes.length === 0) return message;
  // Filter out notes with no signal (empty warnings + no suggestion + unreviewed).
  // This keeps the block absent when none of the attached refs have steward state.
  const meaningful = notes.filter((note) => (
    note.warnings.length > 0
    || note.suggestion !== undefined && note.suggestion !== null
    || note.reviewStatus === 'steward_reviewed'
  ));
  if (meaningful.length === 0) return message;
  const metadata = JSON.stringify({
    clawxKnowledgeStewardNotes: meaningful,
    instruction: 'Advisory steward notes about the attached references. Consider the warnings when citing; do not modify knowledge because of these notes. Each note names the steward variant (roleId) that produced it. Notes are persisted review state, not live steward judgment.',
  });
  const block = capContextText(
    `Knowledge steward notes (untrusted metadata): \`\`\`json\n${metadata}\n\`\`\``,
    CONTEXT_FRAGMENT_LIMITS.knowledgeStewardNotesChars,
  );
  return message ? `${block}\n\n${message}` : block;
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

export function createChatApi({ gatewayManager }: { gatewayManager: GatewayManager }): CompleteHostServiceRegistry['chat'] {
  return {
    sendWithMedia: async (payload) => {
      const body = isRecord(payload) ? payload as ChatSendWithMediaPayload : {};
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey : '';
      const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
      if (!sessionKey || !idempotencyKey) {
        return { success: false, error: 'Invalid chat send payload' };
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
        const knowledgeReads = await readSelectedKnowledgeReferences(
          gatewayManager,
          knowledgeScope,
          knowledgeMode,
          knowledgeReferences,
        );
        // Area 5 §3.3 — Load persisted steward notes for the attached references.
        // Best-effort: never throws; absent when no drafts match (zero overhead
        // for non-KB turns). Reads only persisted state — no turn-time LLM call.
        const stewardNotes = await findStewardNotesForReferences(knowledgeReferences);
        let message = applyToolUiResponseContract(typeof body.message === 'string' ? body.message : '');
        message = applyKnowledgeMetadata(message, knowledgeScope, knowledgeMode, knowledgeReferences);
        message = applyKnowledgeReadCitations(message, knowledgeReads);
        message = applyKnowledgeStewardNotes(message, stewardNotes);
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
        if (typeof body.inputMode === 'string' && ['interrupt', 'guide', 'queue', 'revise-goal'].includes(body.inputMode)) {
          rpcParams.inputMode = body.inputMode;
        }
        // Area 2 §3.2: forward turn-scoped model override to runtime chat.send.
        // Empty/null means "no turn override" — omit so resolution falls through.
        if (typeof body.modelRef === 'string' && body.modelRef.trim()) {
          rpcParams.model = body.modelRef.trim();
        }
        if (imageAttachments.length > 0) {
          rpcParams.attachments = imageAttachments;
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
        return { success: true, ...(response ? { result: response } : {}) };
      } catch (error) {
        logger.error(`[chat:sendWithMedia] Error: ${String(error)}`);
        return { success: false, error: String(error) };
      }
    },
  };
}
