import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeAutonomySessionScope, normalizeRunScope, type AutonomySessionScope } from '../../../shared/types/identity-scope.js';
import type { TaskMaterialObservation } from '../../../shared/task-system/trace.js';
import {
  equalMaterialRef, isReusableMaterial, MATERIAL_SCAN_LIMIT, materialReference, materialSource, parseSessionCollaborationMaterialQuery,
  type SessionCollaborationMaterial, type SessionCollaborationMaterialPage, type SessionCollaborationMaterialRef,
} from '../../../shared/types/session-collaboration-material.js';
import type { StreamFn } from './runtime/index.js';
import type { ToolSearchTargetTranscriptProjection } from './tool-search.js';
import {
  querySessionCollaborationMaterialsTool, querySessionCollaborationMaterialBatchTool, readSessionCollaborationToolOwner, type SessionCollaborationToolContext,
} from './tools/session-collaboration-query.js';

const TOOL_SCHEMA = 'SessionCollaborationMaterialTool/v1';
const LEGACY_SCHEMA = 'SessionCollaborationMaterials/v1';
const MAX_SELECTIONS = 4;
const MATERIAL_WRAPPERS = new Set(['tool_call', 'tool_search_code', 'exec', 'wait']);
type Selection = { ref: SessionCollaborationMaterialRef; source: AutonomySessionScope; reader: AutonomySessionScope; runId: string; id: string };
type ResultBlock = { text: string; selections: Selection[] };
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function mapMaterialEnvelopes(value: unknown, visit: (data: Record<string, unknown>) => unknown,
  depth = 0, requireComplete = false): unknown {
  if (depth >= 12) {
    if (requireComplete) throw new Error('MATERIAL_PAYLOAD_SCAN_INCOMPLETE');
    return value;
  }
  if (typeof value === 'string') {
    if (!['{', '[', '"'].includes(value.trimStart()[0])) return value;
    if (value.length > 64_000) {
      if (requireComplete) throw new Error('MATERIAL_PAYLOAD_SCAN_INCOMPLETE');
      return value;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { return value; }
    const mapped = mapMaterialEnvelopes(parsed, visit, depth + 1, requireComplete);
    return mapped === parsed ? value : JSON.stringify(mapped);
  }
  if (Array.isArray(value)) {
    const mapped = value.map(item => mapMaterialEnvelopes(item, visit, depth + 1, requireComplete));
    return mapped.some((item, index) => item !== value[index]) ? mapped : value;
  }
  const data = asRecord(value);
  if (!data) return value;
  if (data.schemaVersion === TOOL_SCHEMA || data.schemaVersion === LEGACY_SCHEMA || data.provenance === 'session-material') return visit(data);
  const entries = Object.entries(data).map(([key, child]) => [key, mapMaterialEnvelopes(child, visit, depth + 1, requireComplete)] as const);
  return entries.some(([key, child]) => child !== data[key]) ? Object.fromEntries(entries) : value;
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

function catalogSelections(projections: readonly ToolSearchTargetTranscriptProjection[], runId: string) {
  const selections = new Map<string, Selection>();
  for (const projection of projections) {
    if (projection.toolName !== 'sessions_list' || projection.isError) continue;
    mapMaterialEnvelopes(projection.result, data => {
      if (data.schemaVersion === TOOL_SCHEMA) {
        const selection = selectedMaterial(data.selection, projection.toolCallId, runId);
        if (selection) selections.set(selection.id, selection);
      }
      return data;
    });
  }
  return selections;
}

function sameSelection(a: Selection, b: Selection | null): boolean {
  return b !== null && JSON.stringify(a) === JSON.stringify(b);
}

function replaceMaterialEnvelopes(text: string, replacements: ReadonlyMap<string, { selection: Selection; value: unknown }>): string {
  const replaced = new Set<string>();
  return mapMaterialEnvelopes(text, data => {
    const id = asRecord(data.selection)?.id;
    const replacement = typeof id === 'string' ? replacements.get(id) : undefined;
    if (!replacement || data.schemaVersion !== TOOL_SCHEMA || replaced.has(replacement.selection.id)
      || !sameSelection(replacement.selection, selectedMaterial(data.selection, replacement.selection.id, replacement.selection.runId))) return data;
    replaced.add(replacement.selection.id);
    return replacement.value;
  }) as string;
}

function mapPayloadText(value: unknown, visit: (text: string) => string,
  visitMaterial?: (data: Record<string, unknown>) => unknown): unknown {
  if (typeof value === 'string') return visit(value);
  if (Array.isArray(value)) return value.map(item => mapPayloadText(item, visit, visitMaterial));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const data = value as Record<string, unknown>;
    if (visitMaterial && (data.provenance === 'session-material' || data.schemaVersion === TOOL_SCHEMA)) return visitMaterial(data);
    return Object.fromEntries(Object.entries(data).map(([key, item]) => [key, mapPayloadText(item, visit, visitMaterial)]));
  }
  return value;
}

function modelMaterial(material: SessionCollaborationMaterial, selection: Selection) {
  const { summary, kind, state, applicability, evidenceRefs, artifactRefs } = material;
  return { provenance: 'session-material', toolCallId: selection.id, ref: materialReference(material), source: materialSource(material),
    kind, state, summary, applicability, evidenceRefs, artifactRefs };
}

function currentMaterial(selection: Selection, detail: Detail | null): SessionCollaborationMaterial | null {
  if (!detail || !isReusableMaterial(detail.state) || !equalMaterialRef(selection.ref, materialReference(detail.material)) ||
      (detail.material.expiresAt !== undefined && detail.material.expiresAt <= Date.now())) return null;
  try { normalizeAutonomySessionScope(materialSource(detail.material), selection.source); }
  catch { return null; }
  return detail.material;
}

/**
 * The exact tool result must survive context budgets and provider serialization.
 * The final request gets a fresh owner read, while stored transcript messages retain references.
 */
export function withMaterialPromptUse(streamFn: StreamFn, params: {
  runId: string;
  modelCallId: string;
  read: (selection: Selection) => Promise<Detail | null>;
  readFinal: (selections: readonly Selection[]) => Promise<readonly (Detail | null)[]>;
  record: RecordObservations | ((observations: readonly TaskMaterialObservation[]) => Promise<void>);
  projections?: readonly ToolSearchTargetTranscriptProjection[];
}): StreamFn {
  return (model, context, options) => {
    const innerSelections = catalogSelections(params.projections ?? [], params.runId);
    const blocks: ResultBlock[] = [];
    const legacy = { schemaVersion: TOOL_SCHEMA, state: 'stale', reason: 'refresh-material-reference' };
    const messages = context.messages.map(message => {
      if (message.role !== 'toolResult' || (message.toolName !== 'sessions_list' && !MATERIAL_WRAPPERS.has(message.toolName))) return message;
      let changed = false;
      const content = message.content.map(block => {
        if (block.type !== 'text') return block;
        const selections = new Map<string, Selection>();
        const raw = /^\{\s*"schemaVersion"\s*:\s*"SessionCollaborationMaterials\/v1"/.test(block.text)
          ? JSON.stringify(legacy) : block.text;
        const text = mapMaterialEnvelopes(raw, data => {
          if (data.schemaVersion === LEGACY_SCHEMA) return legacy;
          if (data.schemaVersion !== TOOL_SCHEMA) return data;
          const id = asRecord(data.selection)?.id;
          const direct = message.toolName === 'sessions_list';
          const inner = !direct && typeof id === 'string' ? innerSelections.get(id) : undefined;
          const selection = direct ? selectedMaterial(data.selection, message.toolCallId, params.runId)
            : inner && sameSelection(inner, selectedMaterial(data.selection, inner.id, params.runId)) ? inner : null;
          if (selection && !message.isError) selections.set(selection.id, selection);
          return data;
        }) as string;
        if (selections.size) blocks.push({ text, selections: [...selections.values()] });
        if (text === block.text) return block;
        changed = true;
        return { type: 'text' as const, text };
      });
      return changed ? { ...message, content, details: undefined } : message;
    });
    if (!blocks.length) return streamFn(model, { ...context, messages }, options);

    return (async () => {
      let delivered: Selection[] = [];
      let recorded = false;
      const stream = await streamFn(model, { ...context, messages }, { ...options, onPayload: async (payload, selectedModel) => {
        // Hooks see references only. Hydrate after they settle so rewrites cannot hide material bytes from qualification.
        const transformed = await options?.onPayload?.(payload, selectedModel);
        const prepared = transformed ?? payload;
        const authorized = new Map(blocks.flatMap(block => block.selections.map(selection => [selection.id, selection] as const)));
        const order = new Map([...authorized.keys()].map((id, index) => [id, index]));
        const requestBlocks: ResultBlock[] = [];
        const collectBlock = (text: string) => {
          const selections = new Map<string, Selection>();
          mapMaterialEnvelopes(text, data => {
            const id = asRecord(data.selection)?.id;
            const selection = typeof id === 'string' ? authorized.get(id) : undefined;
            if (data.schemaVersion === TOOL_SCHEMA && selection &&
                sameSelection(selection, selectedMaterial(data.selection, selection.id, params.runId))) selections.set(selection.id, selection);
            return data;
          }, 0, true);
          if (selections.size) requestBlocks.push({ text, selections: [...selections.values()]
            .sort((a, b) => order.get(a.id)! - order.get(b.id)!) });
          return text;
        };
        mapPayloadText(prepared, collectBlock, data => { collectBlock(JSON.stringify(data)); return data; });
        requestBlocks.sort((a, b) => order.get(a.selections.at(-1)!.id)! - order.get(b.selections.at(-1)!.id)!);
        const replacements = new Map<string, { text: string; selections: Selection[] }>();
        const unavailable = { schemaVersion: TOOL_SCHEMA, state: 'unavailable', reason: 'material-use-unavailable' };
        const seen = new Set<string>();
        let deliveredCount = 0;
        for (const block of [...requestBlocks].reverse()) {
          if (deliveredCount >= MAX_SELECTIONS || seen.size >= MATERIAL_SCAN_LIMIT || options?.signal?.aborted) break;
          const entries = new Map<string, { selection: Selection; value: unknown }>();
          const selected: Selection[] = [];
          let text = block.text;
          for (const selection of [...block.selections].reverse()) {
            if (deliveredCount >= MAX_SELECTIONS || seen.size >= MATERIAL_SCAN_LIMIT || options?.signal?.aborted) break;
            const key = JSON.stringify([selection.ref, selection.source, selection.reader]);
            if (seen.has(key)) continue;
            seen.add(key);
            let detail: Detail | null;
            try { detail = await params.read(selection); } catch { detail = null; }
            if (options?.signal?.aborted) break;
            const material = currentMaterial(selection, detail);
            if (material) {
              entries.set(selection.id, { selection, value: modelMaterial(material, selection) });
              const candidate = replaceMaterialEnvelopes(block.text, entries);
              if (Buffer.byteLength(candidate) <= Buffer.byteLength(block.text)) {
                text = candidate;
                selected.push(selection);
                deliveredCount++;
                continue;
              }
            }
            entries.set(selection.id, { selection, value: unavailable });
            const candidate = replaceMaterialEnvelopes(block.text, entries);
            if (Buffer.byteLength(candidate) <= Buffer.byteLength(block.text)) text = candidate;
            else entries.delete(selection.id);
          }
          if (text !== block.text) replacements.set(block.text, { text, selections: selected });
        }
        const applied = new Set<string>();
        let outbound = replacements.size ? mapPayloadText(prepared, value => {
          for (const [original, replacement] of replacements) {
            if (applied.has(original) || !value.includes(original)) continue;
            value = value.replace(original, () => replacement.text);
            applied.add(original);
          }
          return value;
        }, data => {
          const original = JSON.stringify(data);
          const replacement = replacements.get(original);
          if (!replacement || applied.has(original)) return data;
          applied.add(original);
          return JSON.parse(replacement.text);
        }) : prepared;
        // Sequential owner reads may outlive another selection. Requalify the hydrated envelopes together.
        const candidates = new Map([...replacements.values()].flatMap(replacement =>
          replacement.selections.map(selection => [selection.id, selection] as const)));
        const present = new Set<string>();
        const collect = (data: Record<string, unknown>) => {
          if (data.provenance === 'session-material' && typeof data.toolCallId === 'string' && candidates.has(data.toolCallId))
            present.add(data.toolCallId);
          return data;
        };
        // A bounded transcript scan may skip a candidate; a final payload scan must never skip hydrated bytes.
        mapPayloadText(outbound, text => mapMaterialEnvelopes(text, collect, 0, true) as string, collect);
        const selected = [...candidates.values()].filter(selection => present.has(selection.id));
        let details: readonly (Detail | null)[] = [];
        try { if (selected.length) details = await params.readFinal(selected); } catch { /* Unavailable final owners remove their material. */ }
        const current = new Map(selected.map((selection, index) => [selection.id,
          details.length === selected.length ? details[index] : null] as const));
        const confirmed = new Map<string, Selection>();
        const qualify = (data: Record<string, unknown>) => {
          if (data.provenance !== 'session-material') return data;
          const id = typeof data.toolCallId === 'string' ? data.toolCallId : '';
          const selection = candidates.get(id);
          const material = selection && !options?.signal?.aborted ? currentMaterial(selection, current.get(id) ?? null) : null;
          if (!selection || !material || !isDeepStrictEqual(data, JSON.parse(JSON.stringify(modelMaterial(material, selection)))))
            return unavailable;
          confirmed.set(id, selection);
          return data;
        };
        outbound = mapPayloadText(outbound, text => mapMaterialEnvelopes(text, qualify, 0, true) as string, qualify);
        delivered = [...candidates.values()].filter(selection => confirmed.has(selection.id));
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
        for await (const event of { [Symbol.asyncIterator]: iterate }) {
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

export function withSessionMaterialPromptUse(streamFn: StreamFn, opts: SessionCollaborationToolContext & { runId: string },
  modelCallId: string, projections: readonly ToolSearchTargetTranscriptProjection[]): StreamFn {
  return withMaterialPromptUse(streamFn, {
    runId: opts.runId, modelCallId, projections,
    read: async selection => {
      const page = await querySessionCollaborationMaterialsTool(opts, { ref: selection.ref, target: selection.source });
      normalizeAutonomySessionScope(page.requester, selection.reader);
      return page.detail;
    },
    readFinal: async selections => {
      const pages = await querySessionCollaborationMaterialBatchTool(opts, selections);
      return pages.map((page, index) => {
        normalizeAutonomySessionScope(page.requester, selections[index].reader);
        return page.detail;
      });
    },
    record: observations => recordSessionMaterialObservations(opts, observations),
  });
}
