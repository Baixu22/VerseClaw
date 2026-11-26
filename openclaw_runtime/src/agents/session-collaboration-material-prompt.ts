import { createHash } from 'node:crypto';
import { normalizeAutonomySessionScope, normalizeRunScope, type AutonomySessionScope } from '../../../shared/types/identity-scope.js';
import type { TaskMaterialObservation } from '../../../shared/task-system/trace.js';
import {
  equalMaterialRef, isReusableMaterial, materialReference, materialSource, parseSessionCollaborationMaterialQuery,
  type SessionCollaborationMaterial, type SessionCollaborationMaterialPage, type SessionCollaborationMaterialRef,
} from '../../../shared/types/session-collaboration-material.js';
import type { StreamFn } from './runtime/index.js';
import {
  querySessionCollaborationMaterialsTool, readSessionCollaborationToolOwner, type SessionCollaborationToolContext,
} from './tools/session-collaboration-query.js';

const TOOL_SCHEMA = 'SessionCollaborationMaterialTool/v1';
const LEGACY_SCHEMA = 'SessionCollaborationMaterials/v1';
const MAX_SELECTIONS = 4;
type Selection = { ref: SessionCollaborationMaterialRef; source: AutonomySessionScope; reader: AutonomySessionScope; runId: string; id: string };
type Detail = NonNullable<SessionCollaborationMaterialPage['detail']>;
type RecordObservations = (observations: readonly TaskMaterialObservation[]) => void;

export async function recordSessionMaterialObservations(opts: SessionCollaborationToolContext, observations: readonly TaskMaterialObservation[]) {
  if (!observations.length) return;
  const { owner, generation, root } = readSessionCollaborationToolOwner(opts);
  if (!root || owner.sessionGeneration !== generation) return;
  for (const observation of observations) normalizeAutonomySessionScope(observation.reader, owner);
  const { recordExecutionMaterialObservations } = await import('./execution-task-authority.js');
  recordExecutionMaterialObservations(root, observations);
}

/** Durable tool results carry references. The provider payload receives temporary material bytes. */
export async function materialToolResult(page: SessionCollaborationMaterialPage, toolCallId: string, opts?: SessionCollaborationToolContext) {
  const { requester: reader, detail } = page;
  const selected = detail ? { ref: materialReference(detail.material), source: materialSource(detail.material), state: detail.state } : null;
  const selection: Selection | null = opts?.runId && selected && isReusableMaterial(selected.state)
    ? { ref: selected.ref, source: selected.source, reader, runId: opts.runId, id: toolCallId } : null;
  if (opts?.runId) {
    const run = normalizeRunScope({ runId: opts.runId, scope: reader });
    const observations: TaskMaterialObservation[] = page.items.map(({ source, ref }) =>
      ({ phase: 'candidate', id: toolCallId, reader, source, ref, run }));
    if (selection) observations.push({ phase: 'referenced', id: toolCallId, reader, source: selection.source, ref: selection.ref, run });
    // Material observation is advisory. The original owner read remains usable if its trace is unavailable.
    await recordSessionMaterialObservations(opts, observations).catch(() => {});
  }
  return {
    schemaVersion: TOOL_SCHEMA, state: page.state, reason: page.reason, scanned: page.scanned, nextCursor: page.nextCursor,
    items: page.items.map(({ ref, source, kind, state, sensitivity }) => ({ ref, source, kind, state, sensitivity })),
    detail: selected, selection,
  };
}

function unpack(text: string): Record<string, unknown> | null {
  if (text.length > 64_000 || !text.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function selectedMaterial(value: unknown, toolCallId: string, runId: string): Selection | null {
  if (!value || typeof value !== 'object') return null;
  const selected = value as Selection;
  if (selected.runId !== runId || selected.id !== toolCallId) return null;
  try {
    const query = parseSessionCollaborationMaterialQuery({ requester: selected.reader, target: selected.source, ref: selected.ref });
    return { ref: query.ref!, source: query.target!, reader: query.requester, runId, id: toolCallId };
  } catch { return null; }
}

function mapPayloadText(value: unknown, visit: (text: string) => string): unknown {
  if (typeof value === 'string') return visit(value);
  if (Array.isArray(value)) return value.map(item => mapPayloadText(item, visit));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapPayloadText(item, visit)]));
  return value;
}

function payloadContains(payload: unknown, text: string): boolean {
  if (typeof payload === 'string') return payload.includes(text);
  if (Array.isArray(payload)) return payload.some(value => payloadContains(value, text));
  return Boolean(payload && typeof payload === 'object' && Object.values(payload).some(value => payloadContains(value, text)));
}

function modelMaterial(material: SessionCollaborationMaterial, selection: Selection) {
  const { summary, kind, applicability, evidenceRefs, artifactRefs } = material;
  return { provenance: 'session-material', toolCallId: selection.id, ref: materialReference(material), source: materialSource(material),
    kind, summary, applicability, evidenceRefs, artifactRefs };
}

/**
 * The exact tool result must survive context budgets and provider serialization.
 * The final request gets a fresh owner read, while stored transcript messages retain references.
 */
export function withMaterialPromptUse(streamFn: StreamFn, params: {
  runId: string;
  modelCallId: string;
  read: (selection: Selection) => Promise<Detail | null>;
  record: RecordObservations | ((observations: readonly TaskMaterialObservation[]) => Promise<void>);
}): StreamFn {
  return (model, context, options) => {
    if (!context.messages.some(message => message.role === 'toolResult' && message.toolName === 'sessions_list'))
      return streamFn(model, context, options);
    const selections = new Map<string, Selection>();
    const messages = context.messages.map(message => {
      if (message.role !== 'toolResult' || message.toolName !== 'sessions_list') return message;
      let changed = false;
      const content = message.content.map(block => {
        if (block.type !== 'text') return block;
        const data = unpack(block.text);
        if (data?.schemaVersion === LEGACY_SCHEMA || /^\{\s*"schemaVersion"\s*:\s*"SessionCollaborationMaterials\/v1"/.test(block.text)) {
          changed = true;
          return { type: 'text' as const, text: JSON.stringify({ schemaVersion: TOOL_SCHEMA, state: 'stale', reason: 'refresh-material-reference' }) };
        }
        if (data?.schemaVersion === TOOL_SCHEMA && selections.size < MAX_SELECTIONS) {
          const selection = selectedMaterial(data.selection, message.toolCallId, params.runId);
          if (selection) selections.set(block.text, selection);
        }
        return block;
      });
      return changed ? { ...message, content, details: undefined } : message;
    });
    if (!selections.size) return streamFn(model, { ...context, messages }, options);

    return (async () => {
      let delivered: Selection[] = [];
      let recorded = false;
      const stream = await streamFn(model, { ...context, messages }, { ...options, onPayload: async (payload, selectedModel) => {
        const replacements = new Map<string, { text: string; selection?: Selection }>();
        const unavailable = JSON.stringify({ schemaVersion: TOOL_SCHEMA, state: 'unavailable', reason: 'material-use-unavailable' });
        for (const [text, selection] of selections) {
          if (options?.signal?.aborted || !payloadContains(payload, text)) continue;
          let detail: Detail | null;
          try { detail = await params.read(selection); } catch { detail = null; }
          if (!detail || !isReusableMaterial(detail.state) || !equalMaterialRef(selection.ref, materialReference(detail.material)) ||
              options?.signal?.aborted || (detail.material.expiresAt !== undefined && detail.material.expiresAt <= Date.now())) {
            replacements.set(text, { text: unavailable });
            continue;
          }
          const replacement = JSON.stringify(modelMaterial(detail.material, selection));
          replacements.set(text, Buffer.byteLength(replacement) <= Buffer.byteLength(text) ? { selection, text: replacement } : { text: unavailable });
        }
        const prepared = replacements.size ? mapPayloadText(payload, value => {
          for (const [original, replacement] of replacements) if (value.includes(original)) value = value.replaceAll(original, replacement.text);
          return value;
        }) : payload;
        const transformed = await options?.onPayload?.(prepared, selectedModel);
        const outbound = transformed ?? prepared;
        delivered = [...replacements.values()].flatMap(({ selection, text }) =>
          selection && payloadContains(outbound, text) ? [selection] : []);
        return outbound;
      } });
      const confirm = async (message: Awaited<ReturnType<typeof stream.result>>) => {
        if (recorded || !delivered.length || message.stopReason === 'error' || message.stopReason === 'aborted') return;
        recorded = true;
        const responseDigest = createHash('sha256').update(JSON.stringify(message.content)).digest('hex');
        const observations = delivered.flatMap(({ id, ref, source, reader, runId }) => {
          const recorded = { id, ref, source, reader, modelCallId: params.modelCallId, run: normalizeRunScope({ runId, scope: reader }) };
          return [{ ...recorded, phase: 'prompt-used' as const }, { ...recorded, phase: 'outcome' as const, responseDigest }];
        });
        try { await params.record(observations); } catch { /* The source or trace owner can change while the request is in flight. */ }
      };
      const iterate = stream[Symbol.asyncIterator].bind(stream);
      stream[Symbol.asyncIterator] = async function* () {
        for await (const event of iterate()) {
          if (event.type === 'done') await confirm(event.message);
          yield event;
        }
      };
      const result = stream.result.bind(stream);
      stream.result = async () => {
        const message = await result();
        await confirm(message);
        return message;
      };
      return stream;
    })();
  };
}

export function withSessionMaterialPromptUse(streamFn: StreamFn, opts: SessionCollaborationToolContext & { runId: string }, modelCallId: string): StreamFn {
  return withMaterialPromptUse(streamFn, {
    runId: opts.runId, modelCallId,
    read: async selection => {
      const page = await querySessionCollaborationMaterialsTool(opts, { ref: selection.ref, target: selection.source });
      normalizeAutonomySessionScope(page.requester, selection.reader);
      return page.detail;
    },
    record: observations => recordSessionMaterialObservations(opts, observations),
  });
}
