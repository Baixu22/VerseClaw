/**
 * Runtime-memory consolidation scheduled service (P2-1).
 *
 * Runs the background consolidation pass over the runtime-memory fact store
 * on an interval (default 24h). Pure computation — no LLM, no cron job —
 * activated with the other gateway scheduled services and stopped on close.
 * Persisted writes replay through the runtime-memory integration port so
 * results survive restarts.
 */
import { createRuntimeMemoryRuntimeIntegration } from "../runtime-core/memory-runtime-integration.js";
import {
  runConsolidation,
  DEFAULT_CONSOLIDATION_CONFIG,
} from "../runtime-core/memory-background-consolidation.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";

const RUNTIME_MEMORY_CONSOLIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5_000;

export type RuntimeMemoryConsolidationService = {
  stop: () => void;
};

export function startRuntimeMemoryConsolidationService(params: {
  cfg: OpenClawConfig;
  intervalMs?: number;
  logger?: { info?: (message: string) => void; warn?: (message: string) => void };
}): RuntimeMemoryConsolidationService {
  const intervalMs = params.intervalMs ?? RUNTIME_MEMORY_CONSOLIDATION_INTERVAL_MS;
  const log = params.logger ?? {};
  let timer: ReturnType<typeof setInterval> | null = null;
  let firstRun: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const runOnce = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const integration = createRuntimeMemoryRuntimeIntegration({ config: params.cfg });
      const { store } = integration.loadStore();
      const result = await runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG);
      // Replay persistence for pruned/merged facts so the DB reflects the
      // in-memory consolidation (restart-safe).
      for (const factId of result.prunedFactIds) {
        try {
          integration.invalidateFact({
            schemaVersion: 1,
            invalidationId: `consolidation-${factId}-${Date.now().toString(36)}`,
            factId,
            reason: "expired",
            invalid_at: Date.now(),
            reference_time: Date.now(),
            proposedBy: "deterministic_rule" as const,
            verificationStatus: "deterministic_rule" as const,
            sourceEpisodeRefs: [],
            evidenceRefs: [],
          });
        } catch {
          // Best-effort; a missing fact means it was already invalidated.
        }
      }
      for (const pair of result.mergedPairs) {
        try {
          integration.invalidateFact({
            schemaVersion: 1,
            invalidationId: `consolidation-merge-${pair.absorbedId}-${Date.now().toString(36)}`,
            factId: pair.absorbedId,
            reason: "superseded",
            invalid_at: Date.now(),
            reference_time: Date.now(),
            proposedBy: "deterministic_rule" as const,
            verificationStatus: "deterministic_rule" as const,
            sourceEpisodeRefs: [],
            evidenceRefs: [],
            replacementFactId: pair.survivorId,
          });
        } catch {
          // Best-effort.
        }
      }
      log.info?.(
        `runtime memory consolidation applied (pruned=${result.prunedFactIds.length}, merged=${result.mergedPairs.length}, strengthened=${result.strengthenedFactIds.length}, durationMs=${result.durationMs}).`,
      );
    } catch (error) {
      log.warn?.(
        `runtime memory consolidation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      running = false;
    }
  };

  // Run once shortly after startup to catch up on any missed window.
  firstRun = setTimeout(() => {
    void runOnce();
  }, FIRST_RUN_DELAY_MS);
  timer = setInterval(() => {
    void runOnce();
  }, intervalMs);

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (firstRun) {
        clearTimeout(firstRun);
        firstRun = null;
      }
    },
  };
}
