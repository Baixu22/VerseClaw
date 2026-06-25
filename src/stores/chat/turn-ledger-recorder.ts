/**
 * Turn-to-Task Ledger Recorder
 *
 * Extracts a lightweight structured summary from completed assistant turns
 * and builds Task Ledger events for fire-and-forget auto-recording.
 */
import type { TaskLedgerEventInput, TaskLedgerEvidenceRef } from '@shared/types/task-ledger';
import type { ContentBlock, RawMessage } from './types';
import type { ChatRuntimeEvent } from '../../../shared/chat-runtime-events';

// ── Types ────────────────────────────────────────────────────────

export type TurnLedgerOutcome = 'completed' | 'error' | 'blocked';

export type TurnLedgerSummary = {
  outcome: TurnLedgerOutcome;
  summary: string;
  decisions?: string[];
  filesTouched: string[];
  toolsUsed: string[];
  approvals?: string[];
  evidenceRefs?: TaskLedgerEvidenceRef[];
  reviewNeeded: boolean;
};

export type BuildTurnLedgerEventsOptions = {
  turnId?: string;
  timestamp?: string;
};

// ── Helpers ──────────────────────────────────────────────────────

function getMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as ContentBlock[])
    .filter((block) => block.type === 'text' || block.type === 'thinking')
    .map((block) => block.text ?? block.thinking ?? '')
    .join('\n');
}

function getLastAssistantMessage(messages: RawMessage[]): RawMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i];
  }
  return undefined;
}

function collectToolNames(messages: RawMessage[]): string[] {
  const names = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as ContentBlock[]) {
      if ((block.type === 'tool_use' || block.type === 'toolCall') && block.name) {
        names.add(block.name);
      }
    }
  }
  return [...names].slice(0, 10);
}

function extractFilePaths(text: string): string[] {
  const paths: string[] = [];
  const pattern = /(?:[A-Za-z]:\\[^\s,;:]+|(?:[\w.-]+\/)+[\w.-]+|[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|py|rs|go|java|yml|yaml))/giu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const p = match[0];
    if (!paths.includes(p)) paths.push(p);
    if (paths.length >= 20) break;
  }
  return paths;
}

function extractAllFilePaths(messages: RawMessage[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const msg of messages) {
    const text = getMessageText(msg.content);
    for (const path of extractFilePaths(text)) {
      if (!seen.has(path)) {
        seen.add(path);
        result.push(path);
        if (result.length >= 20) break;
      }
    }
    if (result.length >= 20) break;
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function collectTextFragments(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFragments(item, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record)
    .filter(([key]) => /^(text|content|output|summary|error|stdout|stderr|file|filePath|file_path|path|cwd)$/iu.test(key))
    .flatMap(([, child]) => collectTextFragments(child, depth + 1));
}

function addUnique(target: string[], value: string | undefined | null, limit: number): void {
  const normalized = String(value ?? '').trim();
  if (!normalized || target.includes(normalized) || target.length >= limit) return;
  target.push(normalized);
}

function addEvidenceRef(
  target: TaskLedgerEvidenceRef[],
  ref: TaskLedgerEvidenceRef,
  limit = 30,
): void {
  if (!ref.ref || target.length >= limit) return;
  if (target.some((existing) => existing.type === ref.type && existing.ref === ref.ref)) return;
  target.push(ref);
}

function collectRuntimeTurnEvidence(runtimeEvents: ChatRuntimeEvent[]): Pick<TurnLedgerSummary, 'filesTouched' | 'toolsUsed' | 'approvals' | 'evidenceRefs'> {
  const filesTouched: string[] = [];
  const toolsUsed: string[] = [];
  const approvals: string[] = [];
  const evidenceRefs: TaskLedgerEvidenceRef[] = [];

  for (const event of runtimeEvents) {
    switch (event.type) {
      case 'tool.started':
      case 'tool.updated':
      case 'tool.completed': {
        addUnique(toolsUsed, event.name, 20);
        addEvidenceRef(evidenceRefs, {
          type: 'tool',
          ref: event.toolCallId,
          label: event.name,
        });
        const eventTexts = event.type === 'tool.started'
          ? collectTextFragments(event.args)
          : event.type === 'tool.updated'
            ? collectTextFragments(event.partialResult)
            : [
              ...collectTextFragments(event.result),
              ...collectTextFragments(event.meta),
            ];
        for (const text of eventTexts) {
          for (const path of extractFilePaths(text)) addUnique(filesTouched, path, 30);
        }
        break;
      }
      case 'command.output': {
        addUnique(toolsUsed, event.name ?? event.title ?? 'command', 20);
        if (event.toolCallId || event.itemId) {
          addEvidenceRef(evidenceRefs, {
            type: 'tool',
            ref: event.toolCallId ?? event.itemId ?? '',
            label: event.title ?? event.name ?? 'Command output',
          });
        }
        for (const text of [event.output, event.cwd].filter(Boolean)) {
          for (const path of extractFilePaths(String(text))) addUnique(filesTouched, path, 30);
        }
        break;
      }
      case 'patch.completed': {
        addUnique(toolsUsed, event.name ?? event.title ?? 'apply_patch', 20);
        if (event.toolCallId || event.itemId) {
          addEvidenceRef(evidenceRefs, {
            type: 'tool',
            ref: event.toolCallId ?? event.itemId ?? '',
            label: event.title ?? event.name ?? 'Patch',
          });
        }
        for (const path of extractFilePaths(event.summary ?? '')) addUnique(filesTouched, path, 30);
        break;
      }
      case 'approval.updated': {
        const label = [event.kind, event.status, event.phase, event.message].filter(Boolean).join(': ');
        addUnique(approvals, label || 'approval updated', 20);
        if (event.toolCallId || event.itemId) {
          addEvidenceRef(evidenceRefs, {
            type: 'other',
            ref: event.toolCallId ?? event.itemId ?? '',
            label: event.title ?? label ?? 'Approval',
          });
        }
        break;
      }
      default:
        break;
    }
  }

  for (const file of filesTouched) {
    addEvidenceRef(evidenceRefs, { type: 'file', ref: file });
  }

  return { filesTouched, toolsUsed, approvals, evidenceRefs };
}

function mergeUnique(left: string[], right: string[], limit: number): string[] {
  const merged: string[] = [];
  for (const value of [...left, ...right]) addUnique(merged, value, limit);
  return merged;
}

function withRuntimeEvidence(summary: TurnLedgerSummary, runtimeEvents: ChatRuntimeEvent[]): TurnLedgerSummary {
  if (runtimeEvents.length === 0) return summary;
  const structured = collectRuntimeTurnEvidence(runtimeEvents);
  return {
    ...summary,
    filesTouched: mergeUnique(structured.filesTouched, summary.filesTouched, 30),
    toolsUsed: mergeUnique(structured.toolsUsed, summary.toolsUsed, 20),
    approvals: mergeUnique(structured.approvals ?? [], summary.approvals ?? [], 20),
    evidenceRefs: [
      ...(structured.evidenceRefs ?? []),
      ...(summary.evidenceRefs ?? []),
    ].reduce<TaskLedgerEvidenceRef[]>((refs, ref) => {
      addEvidenceRef(refs, ref);
      return refs;
    }, []),
  };
}

function collectKnowledgeEvidence(userMessage: RawMessage): TaskLedgerEvidenceRef[] {
  const refs = userMessage._knowledgeRefs ?? [];
  return refs.flatMap((reference): TaskLedgerEvidenceRef[] => {
    const ref = reference.lookup || reference.pagePath || reference.sourcePath || reference.id;
    if (!ref) return [];
    const type = reference.corpus === 'memory' ? 'memory' : 'other';
    return [{
      type,
      ref,
      label: reference.title || reference.id || reference.lookup,
    }];
  });
}

function sectionLines(text: string, title: string, limit = 4): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    new RegExp(`^#{0,4}\\s*${title}\\b`, 'iu').test(line.trim()),
  );
  if (start < 0) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,4}\s+\S/u.test(line.trim())) break;
    const trimmed = line.replace(/^[-*]\s*/u, '').trim();
    if (!trimmed || /^(none|n\/a|no\b)/iu.test(trimmed)) continue;
    body.push(trimmed);
    if (body.length >= limit) break;
  }
  return body;
}

// ── Extraction ────────────────────────────────────────────────────

export function extractTurnSummary(
  userMessage: RawMessage,
  assistantMessages: RawMessage[],
  error?: string | null,
  runtimeEvents: ChatRuntimeEvent[] = [],
): TurnLedgerSummary {
  const userText = getMessageText(userMessage.content);
  const intent = userText.length > 100 ? `${userText.slice(0, 97)}...` : userText;
  const knowledgeEvidenceRefs = collectKnowledgeEvidence(userMessage);

  // 1. Try fenced JSON: ```task-ledger ... ```
  for (const msg of assistantMessages) {
    const text = getMessageText(msg.content);
    const match = text.match(/```task-ledger\s*\n([\s\S]*?)\n\s*```/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.outcome && parsed.summary) {
          return withRuntimeEvidence({
            outcome: parsed.outcome as TurnLedgerOutcome,
            summary: String(parsed.summary).slice(0, 500),
            decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(String).slice(0, 10) : undefined,
            filesTouched: Array.isArray(parsed.filesTouched) ? parsed.filesTouched.map(String).slice(0, 20) : [],
            toolsUsed: Array.isArray(parsed.toolsUsed) ? parsed.toolsUsed.map(String).slice(0, 10) : [],
            ...(knowledgeEvidenceRefs.length > 0 ? { evidenceRefs: knowledgeEvidenceRefs } : {}),
            reviewNeeded: parsed.reviewNeeded === true,
          }, runtimeEvents);
        }
      } catch { /* fall through to heuristics */ }
    }
  }

  // 2. Heuristic fallback
  const lastAssistant = getLastAssistantMessage(assistantMessages);
  const lastText = lastAssistant ? getMessageText(lastAssistant.content) : '';
  const toolsUsed = collectToolNames(assistantMessages);
  const filesTouched = extractAllFilePaths(assistantMessages);

  // Extract summary from sections or first lines of final assistant message
  const summarySections = sectionLines(lastText, 'Summary', 3);
  const summary = summarySections.length > 0
    ? summarySections.join('; ')
    : `User asked: "${intent}". ${toolsUsed.length > 0 ? `Used tools: ${toolsUsed.join(', ')}.` : ''}${filesTouched.length > 0 ? ` Touched files: ${filesTouched.slice(0, 5).join(', ')}.` : ''}`.slice(0, 500);

  const decisions = sectionLines(lastText, 'Decisions', 5);

  return withRuntimeEvidence({
    outcome: error ? 'error' : 'completed',
    summary,
    decisions: decisions.length > 0 ? decisions : undefined,
    filesTouched,
    toolsUsed,
    ...(knowledgeEvidenceRefs.length > 0 ? { evidenceRefs: knowledgeEvidenceRefs } : {}),
    reviewNeeded: false,
  }, runtimeEvents);
}

// ── Event Building ────────────────────────────────────────────────

export function buildTurnLedgerEvents(
  workspaceId: string,
  sessionKey: string,
  summary: TurnLedgerSummary,
  taskNodeId?: string | null,
  options: BuildTurnLedgerEventsOptions = {},
): TaskLedgerEventInput[] {
  const events: TaskLedgerEventInput[] = [];
  const timestamp = options.timestamp ?? new Date().toISOString();
  const turnId = options.turnId ?? `${sessionKey}:turn:${Date.now()}`;

  const baseEvidenceRefs: TaskLedgerEvidenceRef[] = [
    { type: 'session', ref: sessionKey, label: 'Turn transcript' },
    ...(summary.evidenceRefs ?? []),
    ...summary.filesTouched.map((f) => ({ type: 'file' as const, ref: f })),
  ];
  const evidenceRefs = baseEvidenceRefs.reduce<TaskLedgerEvidenceRef[]>((refs, ref) => {
    addEvidenceRef(refs, ref);
    return refs;
  }, []);

  const turnTitle = summary.summary.length > 120
    ? `${summary.summary.slice(0, 117)}...`
    : summary.summary;

  events.push({
    type: 'node_created',
    actor: 'assistant',
    taskId: turnId,
    sessionId: sessionKey,
    idempotencyKey: `turn-node:${turnId}`,
    payload: {
      node: {
        id: turnId,
        title: turnTitle,
        kind: summary.outcome === 'error' ? 'deviation' : 'check',
        parentId: taskNodeId ?? null,
        status: summary.outcome === 'error' ? 'blocked' : 'done',
        owner: 'agent',
        priority: 'normal',
        tags: summary.toolsUsed,
        description: summary.summary,
        evidenceRefs,
        metadata: {
          sourceWorkspaceId: workspaceId,
          ...(summary.approvals && summary.approvals.length > 0 ? { approvals: summary.approvals } : {}),
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: summary.outcome === 'error' ? null : timestamp,
      },
    },
  });

  events.push({
    type: 'session_linked',
    actor: 'assistant',
    taskId: turnId,
    sessionId: sessionKey,
    idempotencyKey: `turn-link:${turnId}`,
    payload: {
      sessionLink: {
        id: turnId,
        sessionKey,
        nodeId: turnId,
        relation: 'related',
        summary: summary.summary.slice(0, 300),
        createdAt: timestamp,
      },
    },
  });

  if (summary.reviewNeeded) {
    events.push({
      type: 'review_requested',
      actor: 'assistant',
      taskId: turnId,
      sessionId: sessionKey,
      idempotencyKey: `turn-review:${turnId}`,
      payload: {
        nodeId: turnId,
        reviewReason: 'Agent flagged turn result for review.',
        status: 'review',
      },
    });
  }

  return events;
}
