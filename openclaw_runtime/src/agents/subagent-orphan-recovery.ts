/**
 * Post-restart interrupted-run resume for subagent sessions.
 *
 * After a SIGUSR1 gateway reload aborts in-flight subagent LLM calls,
 * this module scans for interrupted sessions (those with `abortedLastRun: true`
 * that are still tracked as active in the subagent registry) and sends a
 * synthetic resume message to restart their work. Parent notification is handled
 * separately by completion delivery after the child reaches a terminal result.
 *
 * @see https://github.com/openclaw/openclaw/issues/47711
 */

import crypto from "node:crypto";
import type { RecoveryOwnerAdmission } from "../../../shared/recovery-authority/contract.js";
import { getRuntimeConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveAgentIdFromSessionKey,
  resolveStorePath,
  updateSessionStore,
  updateSessionStoreAtomic,
  type SessionEntry,
} from "../config/sessions.js";
import { callGateway } from "../gateway/call.js";
import { readSessionMessagesAsync } from "../gateway/session-utils.fs.js";
import { formatErrorMessage } from "../infra/errors.js";
import { acquireSessionAdmissionPermit } from "../sessions/session-admission-registry.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveInternalSessionEffectsTranscriptPath } from "./internal-session-effects.js";
import {
  evaluateSubagentRecoveryGate,
  markSubagentRecoveryAttempt,
  markSubagentRecoveryWedged,
  matchesSubagentRecoveryGeneration,
} from "./subagent-recovery-state.js";
import {
  finishOwnerRecoveryAdmission,
  isRecoveryAuthorityEnabled,
  getRecoveryAdmissionIdentity,
} from "./recovery-authority/owner-admission.js";
import {
  finalizeInterruptedSubagentRun,
  replaceSubagentRunAfterSteer,
} from "./subagent-registry-steer-runtime.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

import {
  admitSubagentRecovery,
  commitAcceptedSubagentRecovery,
  reconcileAcceptedOrphanRun,
} from "./recovery-authority/subagent-adapter.js";

const log = createSubsystemLogger("subagent-interrupted-resume");

/** Delay before attempting recovery to let the gateway finish bootstrapping. */
const DEFAULT_RECOVERY_DELAY_MS = 5_000;

function isLegacyRestartInterruptedTimeout(
  runRecord: SubagentRunRecord,
  entry: SessionEntry | undefined,
): boolean {
  return (
    entry?.abortedLastRun === true &&
    runRecord.outcome?.status === "timeout" &&
    typeof runRecord.endedAt === "number" &&
    runRecord.endedAt > 0
  );
}

function reclassifyLegacyRestartInterruptedRun(runRecord: SubagentRunRecord): void {
  const interruptedAt = runRecord.endedAt;
  runRecord.execution = {
    ...runRecord.execution,
    status: "interrupted",
    interruptedAt,
    interruptionReason: "gateway-restart",
    endedAt: undefined,
    outcome: undefined,
  };
  runRecord.endedAt = undefined;
  runRecord.endedReason = undefined;
  runRecord.outcome = undefined;
}

/**
 * Build the resume message for an orphaned subagent.
 */
function buildResumeMessage(task: string, lastHumanMessage?: string): string {
  const maxTaskLen = 2000;
  const truncatedTask = task.length > maxTaskLen ? `${task.slice(0, maxTaskLen)}...` : task;

  let message =
    `[System] Your previous turn was interrupted by a gateway reload. ` +
    `Your original task was:\n\n${truncatedTask}\n\n`;

  if (lastHumanMessage) {
    message += `The last message from the user before the interruption was:\n\n${lastHumanMessage}\n\n`;
  }

  message += `Please continue where you left off.`;
  return message;
}

function extractMessageText(msg: unknown): string | undefined {
  if (!msg || typeof msg !== "object") {
    return undefined;
  }
  const m = msg as Record<string, unknown>;
  if (typeof m.content === "string") {
    return m.content;
  }
  if (Array.isArray(m.content)) {
    const text = m.content
      .filter(
        (c: unknown) =>
          typeof c === "object" &&
          c !== null &&
          (c as Record<string, unknown>).type === "text" &&
          typeof (c as Record<string, unknown>).text === "string",
      )
      .map((c: unknown) => (c as Record<string, string>).text)
      .filter(Boolean)
      .join("\n");
    return text || undefined;
  }
  return undefined;
}

/**
 * Send a resume message to an orphaned subagent session via the gateway agent method.
 */
async function resumeOrphanedSession(params: {
  sessionKey: string;
  task: string;
  lastHumanMessage?: string;
  configChangeHint?: string;
  originalRunId: string;
  originalRun: SubagentRunRecord;
  idempotencyKey?: string;
  sessionId?: string;
  admission?: RecoveryOwnerAdmission;
}): Promise<{ resumed: boolean; runId?: string; error?: string }> {
  let resumeMessage = buildResumeMessage(params.task, params.lastHumanMessage);
  if (params.configChangeHint) {
    resumeMessage += params.configChangeHint;
  }

  try {
    const idempotencyKey = params.idempotencyKey ?? crypto.randomUUID();
    const result = await callGateway<{ runId: string }>({
      method: "agent",
      params: {
        message: resumeMessage,
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        ...(params.admission
          ? { recoveryAdmission: getRecoveryAdmissionIdentity(params.admission) }
          : {}),
        idempotencyKey,
        deliver: false,
        lane: "subagent",
        inputProvenance: {
          kind: "inter_session",
          sourceSessionKey: params.originalRun.requesterSessionKey,
          sourceChannel: "internal",
          sourceTool: "subagent_interrupted_resume",
        },
        // Admission binds this run to the original session lifecycle. Prompt
        // persistence is suppressed separately for the synthetic continuation.
        sessionEffects: params.idempotencyKey ? "visible" : "internal",
        suppressPromptPersistence: true,
      },
      timeoutMs: 10_000,
    });
    if (!result?.runId || typeof result.runId !== "string") {
      throw new Error("recovery RPC did not acknowledge a run identity");
    }
    if (params.idempotencyKey) return { resumed: true, runId: result.runId };
    const remapped = replaceSubagentRunAfterSteer({
      previousRunId: params.originalRunId,
      nextRunId: result.runId,
      fallback: params.originalRun,
      transcriptFile: params.idempotencyKey
        ? undefined
        : resolveInternalSessionEffectsTranscriptPath(result.runId),
    });
    if (!remapped) {
      if (params.idempotencyKey) {
        return {
          resumed: false,
          runId: result.runId,
          error:
            "recovery accepted but the registry owner could not be remapped; reconciliation required",
        };
      }
      log.warn(
        `resumed orphaned session ${params.sessionKey} but remap failed (old run already removed); treating resume as accepted to avoid duplicate restarts`,
      );
      return { resumed: true, runId: result.runId };
    }
    log.info(`resumed orphaned session: ${params.sessionKey}`);
    return { resumed: true, runId: result.runId };
  } catch (err) {
    const error = formatErrorMessage(err);
    log.warn(`failed to resume orphaned session ${params.sessionKey}: ${error}`);
    return { resumed: false, error };
  }
}

/**
 * Scan for and resume orphaned subagent sessions after a gateway restart.
 *
 * An orphaned session is one where:
 * 1. It has an active (not ended) entry in the subagent run registry
 * 2. Its session store entry has `abortedLastRun: true`
 *
 * For each orphaned session found, we:
 * 1. Clear the `abortedLastRun` flag
 * 2. Send a synthetic resume message to trigger a new LLM turn
 */
export async function recoverOrphanedSubagentSessions(params: {
  getActiveRuns: () => Map<string, SubagentRunRecord>;
  /** Persisted across retries so already-resumed sessions are not resumed again. */
  resumedSessionKeys?: Set<string>;
}): Promise<{
  recovered: number;
  failed: number;
  skipped: number;
  failedRuns: Array<{ runId: string; childSessionKey: string; error?: string; attempts?: number }>;
  reconciliationRuns: Array<{ runId: string; childSessionKey: string; reason: string }>;
}> {
  const result = {
    recovered: 0,
    failed: 0,
    skipped: 0,
    failedRuns: [] as Array<{
      runId: string;
      childSessionKey: string;
      error?: string;
      attempts?: number;
    }>,
    reconciliationRuns: [] as Array<{ runId: string; childSessionKey: string; reason: string }>,
  };
  const resumedSessionKeys = params.resumedSessionKeys ?? new Set<string>();
  const authorityEnabled = isRecoveryAuthorityEnabled();
  const configChangePattern = /openclaw\.json|openclaw gateway restart|config\.patch/i;

  try {
    const activeRuns = params.getActiveRuns();
    if (activeRuns.size === 0) {
      return result;
    }

    const cfg = getRuntimeConfig();
    const storeCache = new Map<string, Record<string, SessionEntry>>();

    for (const [runId, runRecord] of activeRuns.entries()) {
      const childSessionKey = runRecord.childSessionKey?.trim();
      if (!childSessionKey) {
        continue;
      }
      const now = Date.now();
      if (resumedSessionKeys.has(childSessionKey)) {
        result.skipped++;
        continue;
      }

      let releaseRecoveryPermit: (() => void) | undefined;
      let preserveRecoveryOwner = authorityEnabled;
      try {
        const agentId = resolveAgentIdFromSessionKey(childSessionKey);
        const storePath = resolveStorePath(cfg.session?.store, { agentId });

        let store = storeCache.get(storePath);
        if (!store) {
          store = loadSessionStore(storePath);
          storeCache.set(storePath, store);
        }

        const entry = store[childSessionKey];
        if (!entry) {
          result.skipped++;
          continue;
        }
        const expectedSessionId = entry.sessionId;
        const expectedLifecycleRunId = entry.lifecycleRunId;
        const savedAdmission = entry.subagentRecovery?.authority;
        const admissionMatchesGeneration =
          savedAdmission && matchesSubagentRecoveryGeneration(entry, savedAdmission);
        const hasOwnedAdmission =
          admissionMatchesGeneration &&
          (runId === savedAdmission.ownerId ||
            expectedLifecycleRunId === savedAdmission.idempotencyKey);
        preserveRecoveryOwner ||= Boolean(hasOwnedAdmission);
        if (authorityEnabled || hasOwnedAdmission) {
          // Reset/delete must wait for the admission and its acknowledgement;
          // a closed fence rejects recovery before it can commit or dispatch.
          releaseRecoveryPermit = acquireSessionAdmissionPermit(
            {
              agentId,
              canonicalSessionKey: childSessionKey,
              expectedSessionId,
            },
            "sessions-steer",
          );
          if (expectedLifecycleRunId && expectedLifecycleRunId !== runId) {
            const adopted = await reconcileAcceptedOrphanRun({
              entry,
              storePath,
              sessionKey: childSessionKey,
              originalRunId: runId,
              originalRun: runRecord,
            });
            if (adopted) {
              resumedSessionKeys.add(childSessionKey);
              result.recovered++;
            } else result.skipped++;
            continue;
          }
        }
        if (!authorityEnabled && hasOwnedAdmission && savedAdmission.state !== "settled") {
          // Rollback stops the new writer. Its uncertain durable reservations
          // still forbid a fresh legacy replay until the owner reconciles them.
          result.skipped++;
          result.reconciliationRuns.push({
            runId,
            childSessionKey,
            reason: "existing recovery admission requires reconciliation before legacy replay",
          });
          continue;
        }

        if (isLegacyRestartInterruptedTimeout(runRecord, entry)) {
          reclassifyLegacyRestartInterruptedRun(runRecord);
        }

        // Terminal child outcomes are immutable. Restart resume only applies to
        // non-terminal interrupted execution; delivery retry handles terminal
        // child results separately.
        if (typeof runRecord.endedAt === "number" && runRecord.endedAt > 0) {
          result.skipped++;
          continue;
        }

        // Check if this session was aborted by the restart
        if (!entry.abortedLastRun) {
          result.skipped++;
          continue;
        }

        const recoveryGate = evaluateSubagentRecoveryGate(entry, now);
        if (!recoveryGate.allowed && !authorityEnabled) {
          if (recoveryGate.shouldMarkWedged) {
            try {
              await updateSessionStore(storePath, (currentStore) => {
                const current = currentStore[childSessionKey];
                if (
                  current &&
                  current.sessionId === expectedSessionId &&
                  current.lifecycleRunId === expectedLifecycleRunId
                ) {
                  markSubagentRecoveryWedged({
                    entry: current,
                    now,
                    runId,
                    reason: recoveryGate.reason,
                  });
                  currentStore[childSessionKey] = current;
                }
              });
              markSubagentRecoveryWedged({
                entry,
                now,
                runId,
                reason: recoveryGate.reason,
              });
            } catch (err) {
              log.warn(
                `failed to persist wedged subagent recovery marker for ${childSessionKey}: ${String(err)}`,
              );
            }
          }
          log.warn(`skipping orphan recovery for ${childSessionKey}: ${recoveryGate.reason}`);
          result.skipped++;
          result.failedRuns.push({
            runId,
            childSessionKey,
            error: recoveryGate.reason,
          });
          continue;
        }

        log.info(`found orphaned subagent session: ${childSessionKey} (run=${runId})`);

        const messages = await readSessionMessagesAsync(
          entry.sessionId,
          storePath,
          entry.sessionFile,
          {
            mode: "recent",
            maxMessages: 200,
            maxBytes: 1024 * 1024,
          },
        );
        const lastHumanMessage = [...messages]
          .toReversed()
          .find((msg) => (msg as { role?: unknown } | null)?.role === "user");
        const configChangeDetected = messages.some((msg) => {
          if ((msg as { role?: unknown } | null)?.role !== "assistant") {
            return false;
          }
          const text = extractMessageText(msg);
          return typeof text === "string" && configChangePattern.test(text);
        });

        const admissionResult = authorityEnabled
          ? await admitSubagentRecovery({
              storePath,
              sessionKey: childSessionKey,
              sessionId: expectedSessionId,
              lifecycleRunId: expectedLifecycleRunId,
              originalRunId: runId,
              messages,
              now,
              getCurrentRun: () => params.getActiveRuns().get(runId),
            })
          : undefined;
        if (admissionResult && admissionResult.kind !== "admitted") {
          result.skipped++;
          if (admissionResult.kind === "failed")
            result.failedRuns.push({
              runId,
              childSessionKey,
              error: admissionResult.reason,
              attempts: admissionResult.attempts,
            });
          if (admissionResult.kind === "blocked")
            result.reconciliationRuns.push({
              runId,
              childSessionKey,
              reason: admissionResult.reason,
            });
          continue;
        }
        const admission = admissionResult?.kind === "admitted" ? admissionResult.record : undefined;

        // Resume the session with the original task context.
        // We intentionally do NOT clear abortedLastRun before attempting
        // the resume — if callGateway fails (e.g. gateway still booting),
        // the flag stays true so the next restart can retry.
        const resumeResult = await resumeOrphanedSession({
          sessionKey: childSessionKey,
          task: runRecord.task,
          lastHumanMessage: extractMessageText(lastHumanMessage),
          configChangeHint: configChangeDetected
            ? "\n\n[config changes from your previous run were already applied — do not re-modify openclaw.json or restart the gateway]"
            : undefined,
          originalRunId: runId,
          originalRun: runRecord,
          idempotencyKey: admission?.idempotencyKey,
          sessionId: admission ? expectedSessionId : undefined,
          admission,
        });

        if (admission && resumeResult.resumed && resumeResult.runId) {
          const committed = await commitAcceptedSubagentRecovery({
            entry: {
              ...entry,
              sessionId: expectedSessionId,
              lifecycleRunId: expectedLifecycleRunId,
            },
            storePath,
            sessionKey: childSessionKey,
            originalRunId: runId,
            originalRun: runRecord,
            admission,
            runId: resumeResult.runId,
          });
          if (!committed) {
            result.skipped++;
            result.reconciliationRuns.push({
              runId,
              childSessionKey,
              reason: "recovery acknowledgement requires lifecycle reconciliation",
            });
            continue;
          }
        }

        if (admission && !resumeResult.resumed) {
          const expectedAdmission = admission;
          await updateSessionStoreAtomic(storePath, (currentStore) => {
            const current = currentStore[childSessionKey];
            if (
              !current ||
              current.sessionId !== expectedSessionId ||
              (current.lifecycleRunId !== expectedLifecycleRunId &&
                current.lifecycleRunId !== resumeResult.runId &&
                current.lifecycleRunId !== expectedAdmission.idempotencyKey)
            )
              return;
            const finished = finishOwnerRecoveryAdmission(
              current.subagentRecovery?.authority,
              expectedAdmission,
              "reconcile",
            );
            if (finished) {
              current.subagentRecovery = { ...current.subagentRecovery, authority: finished };
              current.updatedAt = finished.updatedAt;
            }
          });
        }

        if (admission && !resumeResult.resumed) {
          result.reconciliationRuns.push({
            runId,
            childSessionKey,
            reason: resumeResult.error ?? "recovery acknowledgement is unknown",
          });
          result.skipped++;
          continue;
        }
        if (resumeResult.resumed) {
          resumedSessionKeys.add(childSessionKey);
          // Only clear the aborted flag after confirmed successful resume.
          try {
            if (!admission)
              await updateSessionStore(storePath, (currentStore) => {
                const current = currentStore[childSessionKey];
                if (
                  current &&
                  current.sessionId === expectedSessionId &&
                  (current.lifecycleRunId === expectedLifecycleRunId ||
                    current.lifecycleRunId === resumeResult.runId)
                ) {
                  current.abortedLastRun = false;
                  if (recoveryGate.allowed)
                    markSubagentRecoveryAttempt({
                      entry: current,
                      now: Date.now(),
                      runId,
                      attempt: recoveryGate.nextAttempt,
                    });
                  current.updatedAt = Date.now();
                  currentStore[childSessionKey] = current;
                }
              });
          } catch (err) {
            log.warn(
              `resume succeeded but failed to update session store for ${childSessionKey}: ${String(err)}`,
            );
          }
          result.recovered++;
        } else {
          // Flag stays as abortedLastRun=true so next restart can retry
          log.warn(
            `resume failed for ${childSessionKey}; abortedLastRun flag preserved for retry on next restart`,
          );
          result.failed++;
          result.failedRuns.push({
            runId,
            childSessionKey,
            error: resumeResult.error,
          });
        }
      } catch (err) {
        const error = formatErrorMessage(err);
        log.warn(`error processing orphaned session ${childSessionKey}: ${error}`);
        if (preserveRecoveryOwner) {
          result.skipped++;
          result.reconciliationRuns.push({ runId, childSessionKey, reason: error });
        } else {
          result.failed++;
          result.failedRuns.push({ runId, childSessionKey, error });
        }
      } finally {
        releaseRecoveryPermit?.();
      }
    }
  } catch (err) {
    log.warn(`orphan recovery scan failed: ${String(err)}`);
    // Ensure retry logic fires for scan-level exceptions.
    if (result.failed === 0) {
      result.failed = 1;
    }
  }

  if (result.recovered > 0 || result.failed > 0) {
    log.info(
      `orphan recovery complete: recovered=${result.recovered} failed=${result.failed} skipped=${result.skipped}`,
    );
  }

  return result;
}

/** Maximum number of retry attempts for orphan recovery. */
const MAX_RECOVERY_RETRIES = 3;
/** Backoff multiplier between retries (exponential). */
const RETRY_BACKOFF_MULTIPLIER = 2;

function buildRecoveryFailureMessage(params: { attempts: number; error?: string }): string {
  const base =
    `Subagent run was interrupted by a gateway restart or connection loss. ` +
    `Automatic recovery failed after ${params.attempts} attempt${params.attempts === 1 ? "" : "s"}. ` +
    `Please retry.`;
  const detail = params.error?.trim();
  if (!detail) {
    return base;
  }
  return `${base} (${detail})`;
}

/**
 * Schedule orphan recovery after a delay, with retry logic.
 * The delay gives the gateway time to fully bootstrap after restart.
 * If recovery fails (e.g. gateway not yet ready), retries with exponential backoff.
 */
export function scheduleOrphanRecovery(params: {
  getActiveRuns: () => Map<string, SubagentRunRecord>;
  delayMs?: number;
  maxRetries?: number;
}): void {
  const initialDelay = params.delayMs ?? DEFAULT_RECOVERY_DELAY_MS;
  const maxRetries = params.maxRetries ?? MAX_RECOVERY_RETRIES;

  const resumedSessionKeys = new Set<string>();
  const attemptRecovery = (attempt: number, delay: number) => {
    setTimeout(() => {
      void recoverOrphanedSubagentSessions({
        ...params,
        resumedSessionKeys,
      })
        .then((result) => {
          if ((result.failed > 0 || result.reconciliationRuns.length > 0) && attempt < maxRetries) {
            const nextDelay = delay * RETRY_BACKOFF_MULTIPLIER;
            log.info(
              `orphan recovery had ${result.failed} failure(s); retrying in ${nextDelay}ms (attempt ${attempt + 1}/${maxRetries})`,
            );
            attemptRecovery(attempt + 1, nextDelay);
            return;
          }
          if (result.failedRuns.length === 0) {
            return;
          }
          const attempts = attempt + 1;
          void Promise.allSettled(
            result.failedRuns.map((run) =>
              finalizeInterruptedSubagentRun({
                runId: run.runId,
                childSessionKey: run.childSessionKey,
                error: buildRecoveryFailureMessage({
                  attempts: run.attempts ?? attempts,
                  error: run.error,
                }),
              }),
            ),
          );
        })
        .catch((err: unknown) => {
          if (attempt < maxRetries) {
            const nextDelay = delay * RETRY_BACKOFF_MULTIPLIER;
            log.warn(
              `scheduled orphan recovery failed: ${String(err)}; retrying in ${nextDelay}ms (attempt ${attempt + 1}/${maxRetries})`,
            );
            attemptRecovery(attempt + 1, nextDelay);
          } else {
            log.warn(
              `scheduled orphan recovery failed after ${maxRetries} retries: ${String(err)}`,
            );
          }
        });
    }, delay).unref?.();
  };

  attemptRecovery(0, initialDelay);
}
