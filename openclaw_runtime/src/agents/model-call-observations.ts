/**
 * Out-of-band correlation between provider model calls and transcript entries.
 *
 * Receipt/seal observation is opt-in. When active, the stream wrapper records a
 * bounded call identity and marks the final assistant message with a non-prompt
 * symbol. Session persistence projects that identity onto the message entry as
 * `modelCall` metadata. Calls that never produce a persisted message are drained
 * at agent end into an ignored custom entry, so "no produced entry" is explicit
 * rather than inferred from a timestamp.
 *
 * This module never carries prompt, tool output, credentials, or other payload.
 */
export const MODEL_CALL_OBSERVATION_SYMBOL = Symbol.for("openclaw.modelCallObservation");
export const MODEL_CALL_CORRELATION_ENTRY_TYPE = "openclaw.model_call_correlation";

export type ModelCallObservation = {
  sessionKey?: string;
  runId?: string;
  traceId?: string;
  providerId?: string;
  adapterId?: string;
  modelId?: string;
  attemptIndex: number;
  modelCallIndex: number;
  wireAttemptIndex?: number;
  correlationDigest?: string;
};

type ModelCallState = {
  observation: ModelCallObservation;
  completed: boolean;
  persistedEntryId?: string;
};

const callStatesBySession = new Map<string, Map<string, ModelCallState>>();
const observationsByMessage = new WeakMap<object, ModelCallObservation>();

function normalizeObservation(input: ModelCallObservation): ModelCallObservation {
  return {
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.adapterId ? { adapterId: input.adapterId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    attemptIndex: input.attemptIndex,
    modelCallIndex: input.modelCallIndex,
    ...(input.wireAttemptIndex !== undefined
      ? { wireAttemptIndex: input.wireAttemptIndex }
      : {}),
    ...(input.correlationDigest ? { correlationDigest: input.correlationDigest } : {}),
  };
}

export function modelCallObservationKey(input: ModelCallObservation): string {
  return [
    input.runId ?? "",
    input.attemptIndex,
    input.modelCallIndex,
    input.wireAttemptIndex ?? 0,
  ].join("|");
}

export function attachModelCallObservation(
  message: object,
  observation: ModelCallObservation,
): void {
  const normalized = normalizeObservation(observation);
  try {
    Object.defineProperty(message, MODEL_CALL_OBSERVATION_SYMBOL, {
      value: normalized,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } catch {
    // Symbol attachment is best-effort observation; the WeakMap below remains
    // sufficient for in-process persistence.
  }
  observationsByMessage.set(message, normalized);
}

export function readModelCallObservation(
  message: object,
): ModelCallObservation | undefined {
  const attached = observationsByMessage.get(message);
  if (attached) return attached;
  const symbolValue = (message as { [MODEL_CALL_OBSERVATION_SYMBOL]?: unknown })[
    MODEL_CALL_OBSERVATION_SYMBOL
  ];
  if (
    !symbolValue ||
    typeof symbolValue !== "object" ||
    typeof (symbolValue as { attemptIndex?: unknown }).attemptIndex !== "number" ||
    typeof (symbolValue as { modelCallIndex?: unknown }).modelCallIndex !== "number"
  ) {
    return undefined;
  }
  const normalized = normalizeObservation(symbolValue as ModelCallObservation);
  observationsByMessage.set(message, normalized);
  return normalized;
}

function stateFor(sessionId: string, observation: ModelCallObservation): ModelCallState {
  let byKey = callStatesBySession.get(sessionId);
  if (!byKey) {
    byKey = new Map();
    callStatesBySession.set(sessionId, byKey);
  }
  const normalized = normalizeObservation(observation);
  const key = modelCallObservationKey(normalized);
  let state = byKey.get(key);
  if (!state) {
    state = { observation: normalized, completed: false };
    byKey.set(key, state);
  }
  return state;
}

export function recordModelCallStart(
  sessionId: string,
  observation: ModelCallObservation,
): void {
  stateFor(sessionId, observation);
}

export function recordModelCallCompleted(
  sessionId: string,
  observation: ModelCallObservation,
  message?: object,
): void {
  const state = stateFor(sessionId, observation);
  state.completed = true;
  if (message) attachModelCallObservation(message, state.observation);
}

export function markModelCallPersisted(
  sessionId: string,
  observation: ModelCallObservation,
  entryId: string,
): void {
  const state = stateFor(sessionId, observation);
  state.persistedEntryId = entryId;
}

export function drainUnpersistedModelCalls(
  sessionId: string,
): ModelCallObservation[] {
  const byKey = callStatesBySession.get(sessionId);
  if (!byKey) return [];
  const pending = [...byKey.values()]
    .filter((state) => !state.persistedEntryId)
    .map((state) => state.observation);
  callStatesBySession.delete(sessionId);
  return pending;
}

export function clearModelCallObservations(sessionId: string): void {
  callStatesBySession.delete(sessionId);
}

export function resetModelCallObservationsForTests(): void {
  callStatesBySession.clear();
}