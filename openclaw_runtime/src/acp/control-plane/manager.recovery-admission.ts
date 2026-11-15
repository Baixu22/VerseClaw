/** Durable ACP-row admission and output boundaries for automatic recovery. */
import { resolveSessionIdentityFromMeta } from "@openclaw/acp-core/runtime/session-identity";
import type {
  EffectCertainty,
  RecoveryAuthorityRequest,
} from "../../../../shared/recovery-authority/contract.js";
import {
  buildRecoveryAdmissionKey,
  finishOwnerRecoveryAdmission,
  isRecoveryAuthorityEnabled,
  prepareOwnerRecoveryAdmission,
} from "../../agents/recovery-authority/owner-admission.js";
import { loadSessionStore } from "../../config/sessions/store-load.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../../infra/kysely-sync.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
} from "../../state/openclaw-state-db.js";
import type { DB } from "../../state/openclaw-state-db.generated.js";
import { isPidDefinitelyDead } from "../../shared/pid-alive.js";
import { AcpRuntimeError } from "../../runtime/errors.ts";
import { readAcpSessionEntry } from "../runtime/session-meta.js";
import type {
  AcpSessionManagerDeps,
  ManagerTurnRecovery,
  ManagerTurnRecoveryState,
  SessionAcpMeta,
  WriteManagerSessionMeta,
} from "./manager.types.js";

type RecoveryDatabase = Pick<DB, "acp_sessions">;

// Process-local activity fences the durable PID claim until the whole turn settles.
const activeClaims = new Map<string, symbol>();

/** Only immutable runtime identity fields participate in the owner check. */
export function managerRuntimeIdentity(meta: SessionAcpMeta): string {
  const identity = resolveSessionIdentityFromMeta(meta);
  return JSON.stringify([
    meta.backend,
    meta.agent,
    meta.runtimeSessionName,
    meta.mode,
    meta.cwd ?? null,
    identity?.acpxRecordId ?? null,
    identity?.acpxSessionId ?? null,
    identity?.agentSessionId ?? null,
  ]);
}

function readRecoveryRow(sessionKey: string) {
  const { db } = openOpenClawStateDatabase();
  return executeSqliteQueryTakeFirstSync(
    db,
    getNodeSqliteKysely<RecoveryDatabase>(db)
      .selectFrom("acp_sessions")
      .selectAll()
      .where("session_key", "=", sessionKey),
  );
}

function parseRecoveryState(raw: string | null): ManagerTurnRecoveryState | undefined {
  if (raw == null) return undefined;
  const value = JSON.parse(raw) as ManagerTurnRecoveryState;
  if (
    !value ||
    !value.sessionId ||
    !value.requestId ||
    !value.boundary ||
    !value.identity ||
    !Number.isSafeInteger(value.attempts) ||
    value.attempts < 0 ||
    !Number.isSafeInteger(value.maxAttempts) ||
    value.maxAttempts < 1 ||
    !["not_applied", "unknown", "applied", "reconciled"].includes(value.effect) ||
    typeof value.visibleOutputObserved !== "boolean" ||
    (value.processId !== undefined &&
      (!Number.isSafeInteger(value.processId) || value.processId < 1)) ||
    (value.authority &&
      (value.authority.ownerId !== value.sessionId ||
        value.authority.attempts !== value.attempts ||
        value.authority.decision?.entry !== "acp-runtime-resume" ||
        !value.authority.ownerEpoch))
  ) {
    throw new AcpRuntimeError("ACP_TURN_FAILED", "ACP recovery owner state is malformed.");
  }
  return value;
}

function saveRecoveryState(sessionKey: string, state: ManagerTurnRecoveryState): void {
  const { db } = openOpenClawStateDatabase();
  const saved = executeSqliteQuerySync(
    db,
    getNodeSqliteKysely<RecoveryDatabase>(db)
      .updateTable("acp_sessions")
      .set({ recovery_json: JSON.stringify(state) })
      .where("session_key", "=", sessionKey),
  );
  if (saved.numAffectedRows !== 1n)
    throw new AcpRuntimeError("ACP_TURN_FAILED", "ACP recovery journal row was not committed.");
}

function retainCommittedManagerRecovery(
  context: ManagerTurnRecovery,
  next: ManagerTurnRecoveryState | undefined,
): void {
  if (next && readRecoveryRow(context.sessionKey)?.recovery_json === JSON.stringify(next))
    context.state = next;
}

/** Release only this exact claim; uncertain effects retain their reconciliation state. */
export function releaseManagerTurnRecovery(context: ManagerTurnRecovery): void {
  try {
    runOpenClawStateWriteTransaction(() => {
      if (context.state.processId !== process.pid || !isCurrentManagerTurnRecovery(context)) return;
      const authority = context.state.authority;
      const next = {
        ...context.state,
        processId: undefined,
        ...(authority
          ? {
              authority:
                finishOwnerRecoveryAdmission(
                  authority,
                  authority,
                  context.state.effect === "unknown" ? "reconcile" : "failed",
                ) ?? authority,
            }
          : {}),
      };
      saveRecoveryState(context.sessionKey, next);
      context.state = next;
    });
  } finally {
    if (context.claim && activeClaims.get(context.claim.key) === context.claim.token)
      activeClaims.delete(context.claim.key);
  }
}

/** An owned handle/status acknowledgement may rebind identity without resetting its budget. */
export function rebindManagerTurnRecoveryIdentity(
  sessionKey: string,
  state: ManagerTurnRecoveryState,
  meta: SessionAcpMeta,
): ManagerTurnRecoveryState {
  const next = { ...state, identity: managerRuntimeIdentity(meta) };
  saveRecoveryState(sessionKey, next);
  return next;
}

/** Confirm an identity ACK from its exact committed row and current Session generation. */
export function acknowledgeCommittedManagerRecoveryIdentity(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  expected: ManagerTurnRecoveryState;
  committed?: ManagerTurnRecoveryState;
}): boolean {
  if (!params.committed) return false;
  const stored = readAcpSessionEntry({ cfg: params.cfg, sessionKey: params.sessionKey });
  if (!stored) return false;
  const entry = loadSessionStore(stored.storePath, { skipCache: true })[stored.storeSessionKey];
  if (
    !matchesManagerTurnRecovery({
      sessionKey: stored.storeSessionKey,
      sessionId: entry?.sessionId,
      meta: stored.acp,
      expected: params.committed,
    })
  )
    return false;
  Object.assign(params.expected, params.committed);
  return true;
}

/** Called in the existing ACP metadata transaction. */
export function matchesManagerTurnRecovery(params: {
  sessionKey: string;
  sessionId?: string;
  meta?: SessionAcpMeta;
  expected: ManagerTurnRecoveryState;
}): boolean {
  const row = readRecoveryRow(params.sessionKey);
  return Boolean(
    row &&
    params.sessionId === params.expected.sessionId &&
    row.session_id === params.expected.sessionId &&
    row.recovery_json === JSON.stringify(params.expected) &&
    params.meta &&
    managerRuntimeIdentity(params.meta) === params.expected.identity,
  );
}

export function isCurrentManagerTurnRecovery(context: ManagerTurnRecovery): boolean {
  if (context.claim && activeClaims.get(context.claim.key) !== context.claim.token) return false;
  const entry = loadSessionStore(context.storePath, { skipCache: true })[context.storeKey];
  const row = readRecoveryRow(context.sessionKey);
  if (!entry || !row) return false;
  const identity = row.identity_json ? JSON.parse(row.identity_json) : undefined;
  return matchesManagerTurnRecovery({
    sessionKey: context.sessionKey,
    sessionId: entry.sessionId,
    meta: {
      backend: row.backend,
      agent: row.agent,
      runtimeSessionName: row.runtime_session_name,
      mode: row.mode === "oneshot" ? "oneshot" : "persistent",
      cwd: row.cwd ?? undefined,
      identity,
      state: "idle",
      lastActivityAt: row.last_activity_at,
    },
    expected: context.state,
  });
}

function prepareRecovery(
  state: ManagerTurnRecoveryState,
  meta: SessionAcpMeta,
  sessionKey: string,
  admitted: boolean,
) {
  const request: RecoveryAuthorityRequest = {
    requestId: state.boundary,
    entry: "acp-runtime-resume",
    owner: { kind: "acp-session", ownerId: state.sessionId, sessionKey, backend: meta.backend },
    admission: {
      trigger: "scheduled-retry",
      requiredPreState: "repeated-repair",
      admitted,
      visibleOutputObserved: state.visibleOutputObserved,
    },
    budget: {
      attempts: { current: state.attempts, max: state.maxAttempts },
      backoff: { initialMs: 0, multiplier: 1, maxMs: 0 },
      wedge: { afterAttempts: state.maxAttempts, wedged: state.authority?.state === "wedged" },
    },
    replayClass: "unsafe",
    effect: state.effect,
    requestedAction: "resume",
    idempotencyKey: state.boundary,
    evidence: [
      {
        kind: "domain-journal",
        ref: `acp_sessions:${sessionKey}:recovery_json`,
        role: "effect-truth",
      },
    ],
    requestedAt: Date.now(),
  };
  const prepared = prepareOwnerRecoveryAdmission(request, state.authority);
  const next = {
    ...state,
    authority: prepared.record ?? state.authority,
    attempts: prepared.record?.attempts ?? state.attempts,
    processId: prepared.admitted ? process.pid : state.processId,
  };
  return { prepared, next };
}

/** An original attempt and every recovery retain one ACP-row budget. */
export async function beginManagerTurnRecovery(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  requestId: string;
  text: string;
  attachments?: unknown;
  mode: string;
  meta: SessionAcpMeta;
  maxAttempts: number;
  deps: AcpSessionManagerDeps;
  writeSessionMeta: WriteManagerSessionMeta;
}): Promise<{ context?: ManagerTurnRecovery; settled?: boolean }> {
  const stored = params.deps.readSessionEntry({ cfg: params.cfg, sessionKey: params.sessionKey });
  const initial = readRecoveryRow(stored?.storeSessionKey ?? params.sessionKey);
  const old = initial ? parseRecoveryState(initial.recovery_json) : undefined;
  const claimKey = stored?.entry
    ? JSON.stringify([stored.storePath, stored.storeSessionKey, stored.entry.sessionId])
    : undefined;
  if (
    !isRecoveryAuthorityEnabled() &&
    (!claimKey || !activeClaims.has(claimKey)) &&
    (!old || (old.requestId !== params.requestId && old.effect !== "unknown" && !old.processId))
  )
    return {};
  if (!stored?.entry || !params.requestId.trim())
    throw new AcpRuntimeError(
      "ACP_TURN_FAILED",
      "ACP recovery requires its persisted Session owner.",
    );
  let state: ManagerTurnRecoveryState | undefined;
  let allowed = false;
  let settled = false;
  const sessionKey = stored.storeSessionKey;
  const boundary = buildRecoveryAdmissionKey(
    "acp-runtime-resume",
    stored.entry.sessionId,
    params.requestId,
    JSON.stringify([params.text, params.attachments ?? null, params.mode]),
  );
  const claim = { key: claimKey!, token: Symbol() };
  if (activeClaims.has(claim.key))
    throw new AcpRuntimeError(
      "ACP_TURN_FAILED",
      "ACP recovery requires reconciliation while a turn owner is active.",
    );
  activeClaims.set(claim.key, claim.token);
  try {
    const persisted = await params
      .writeSessionMeta({
        cfg: params.cfg,
        sessionKey,
        failOnError: true,
        expectedSessionId: stored.entry.sessionId,
        mutate: (current, entry) => {
          if (
            !current ||
            entry?.sessionId !== stored.entry!.sessionId ||
            managerRuntimeIdentity(current) !== managerRuntimeIdentity(params.meta)
          )
            return undefined;
          const row = readRecoveryRow(sessionKey);
          if (!row || (row.session_id != null && row.session_id !== entry.sessionId))
            return undefined;
          const previous = parseRecoveryState(row.recovery_json);
          if (previous?.sessionId === entry.sessionId) {
            if (
              previous.processId &&
              previous.processId !== process.pid &&
              !isPidDefinitelyDead(previous.processId)
            ) {
              state = prepareRecovery(previous, current, sessionKey, false).next;
            } else if (previous.requestId === params.requestId || previous.effect === "unknown") {
              const match =
                previous.requestId === params.requestId && previous.boundary === boundary;
              const result = prepareRecovery(
                previous,
                current,
                sessionKey,
                match &&
                  (previous.effect === "applied" ||
                    previous.effect === "reconciled" ||
                    previous.identity === managerRuntimeIdentity(current)),
              );
              state = result.next;
              allowed = match && result.prepared.admitted;
              settled = match && result.prepared.decision.kind === "settle";
            }
          }
          if (!state) {
            const uncertain = !previous && current.state !== "idle";
            state = {
              sessionId: entry.sessionId,
              requestId: params.requestId,
              boundary,
              identity: managerRuntimeIdentity(current),
              attempts: uncertain ? 0 : 1,
              maxAttempts: params.maxAttempts,
              effect: uncertain ? "unknown" : "not_applied",
              visibleOutputObserved: false,
              ...(!uncertain ? { processId: process.pid } : {}),
            };
            if (uncertain) state = prepareRecovery(state, current, sessionKey, true).next;
            else allowed = true;
          }
          saveRecoveryState(sessionKey, state);
          return current;
        },
      })
      .catch((error) => {
        if (state && readRecoveryRow(sessionKey)?.recovery_json === JSON.stringify(state)) {
          releaseManagerTurnRecovery({
            cfg: params.cfg,
            sessionKey,
            storePath: stored.storePath,
            storeKey: stored.storeSessionKey,
            state,
            claim,
            writeSessionMeta: params.writeSessionMeta,
          });
        }
        throw error;
      });
    if (!persisted || !state)
      throw new AcpRuntimeError("ACP_TURN_FAILED", "ACP recovery owner changed before admission.");
    if (!allowed && !settled)
      throw new AcpRuntimeError(
        "ACP_TURN_FAILED",
        "ACP recovery requires reconciliation or has exhausted its persisted budget.",
      );
    return {
      context: {
        cfg: params.cfg,
        sessionKey,
        storePath: stored.storePath,
        storeKey: stored.storeSessionKey,
        state,
        claim,
        writeSessionMeta: params.writeSessionMeta,
      },
      settled,
    };
  } catch (error) {
    if (activeClaims.get(claim.key) === claim.token) activeClaims.delete(claim.key);
    throw error;
  }
}

/** Journal output before publication; reject a stale generation, identity or attempt. */
export async function markManagerTurnRecovery(
  context: ManagerTurnRecovery,
  patch: {
    effect?: EffectCertainty;
    visibleOutputObserved?: boolean;
    state?: SessionAcpMeta["state"];
    lastError?: string;
  },
  expectedMeta?: SessionAcpMeta,
): Promise<void> {
  if (context.claim && activeClaims.get(context.claim.key) !== context.claim.token)
    throw new AcpRuntimeError("ACP_TURN_FAILED", "ACP turn owner is no longer active.");
  let next: ManagerTurnRecoveryState | undefined;
  const persisted = await context
    .writeSessionMeta({
      cfg: context.cfg,
      sessionKey: context.sessionKey,
      failOnError: true,
      expectedSessionId: context.state.sessionId,
      mutate: (current, entry) => {
        const row = readRecoveryRow(context.sessionKey);
        if (
          !current ||
          !entry ||
          !row ||
          row.recovery_json !== JSON.stringify(context.state) ||
          entry.sessionId !== context.state.sessionId ||
          row.session_id !== context.state.sessionId ||
          managerRuntimeIdentity(current) !==
            (expectedMeta ? managerRuntimeIdentity(expectedMeta) : context.state.identity)
        )
          return undefined;
        const authority = context.state.authority;
        const terminal = patch.state === "idle" || patch.state === "error";
        const effect = patch.effect ?? context.state.effect;
        next = {
          ...context.state,
          identity: managerRuntimeIdentity(current),
          effect,
          visibleOutputObserved:
            context.state.visibleOutputObserved || patch.visibleOutputObserved === true,
          processId: terminal ? undefined : context.state.processId,
          ...(authority && terminal
            ? {
                authority:
                  finishOwnerRecoveryAdmission(
                    authority,
                    authority,
                    patch.state === "idle"
                      ? "accepted"
                      : effect === "unknown"
                        ? "reconcile"
                        : "failed",
                  ) ?? authority,
              }
            : {}),
        };
        saveRecoveryState(context.sessionKey, next);
        return {
          ...current,
          ...(patch.state
            ? { state: patch.state, lastError: patch.lastError, lastActivityAt: Date.now() }
            : {}),
        };
      },
    })
    .catch((error) => {
      retainCommittedManagerRecovery(context, next);
      throw error;
    });
  if (!persisted || !next)
    throw new AcpRuntimeError(
      "ACP_TURN_FAILED",
      "ACP recovery no longer owns this runtime identity or attempt.",
    );
  context.state = next;
}

/** Both fresh-handle retries and backend failover use this same committed decision. */
export async function admitManagerTurnRecovery(context: ManagerTurnRecovery): Promise<boolean> {
  if (context.claim && activeClaims.get(context.claim.key) !== context.claim.token) return false;
  let admitted = false;
  let next: ManagerTurnRecoveryState | undefined;
  const persisted = await context
    .writeSessionMeta({
      cfg: context.cfg,
      sessionKey: context.sessionKey,
      failOnError: true,
      expectedSessionId: context.state.sessionId,
      mutate: (current, entry) => {
        if (
          !matchesManagerTurnRecovery({
            sessionKey: context.sessionKey,
            sessionId: entry?.sessionId,
            meta: current,
            expected: context.state,
          }) ||
          !current
        )
          return undefined;
        const result = prepareRecovery(context.state, current, context.sessionKey, true);
        next = result.next;
        admitted = result.prepared.admitted;
        saveRecoveryState(context.sessionKey, next);
        return current;
      },
    })
    .catch((error) => {
      retainCommittedManagerRecovery(context, next);
      throw error;
    });
  if (!persisted || !next) return false;
  context.state = next;
  return admitted;
}
