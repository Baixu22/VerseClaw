/** Executes one agent-requested compaction after the active attempt releases its session lock. */
import type { CompactResult, ContextEngine } from "../../../context-engine/types.js";
import { formatErrorMessage } from "../../../infra/errors.js";
import type { ManualCompactionRequest } from "../../manual-compaction-request.js";

export type ManualCompactionExecutionResult = CompactResult & {
  sessionId: string;
  sessionFile: string;
};

export async function executeManualCompactionRequest(params: {
  request: ManualCompactionRequest;
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  tokenBudget: number;
  runtimeContext: Parameters<ContextEngine["compact"]>[0]["runtimeContext"];
  compact: (input: Parameters<ContextEngine["compact"]>[0]) => Promise<CompactResult>;
  before?: () => Promise<void>;
  after?: (result: CompactResult) => Promise<void>;
  onCompacted?: (result: CompactResult) => Promise<void>;
  onPostProcessingError?: (error: unknown) => void;
}): Promise<ManualCompactionExecutionResult> {
  let result: CompactResult;
  try {
    await params.before?.();
    result = await params.compact({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      sessionFile: params.sessionFile,
      tokenBudget: params.tokenBudget,
      force: true,
      compactionTarget: "threshold",
      customInstructions: params.request.customInstructions,
      runtimeContext: params.runtimeContext,
    });
    if (result.ok && result.compacted) {
      try {
        await params.onCompacted?.(result);
      } catch (error) {
        // The transcript has already compacted; post-processing failures must
        // not discard its rotated session identity or successful result.
        params.onPostProcessingError?.(error);
      }
    }
  } catch (error) {
    result = {
      ok: false,
      compacted: false,
      reason: formatErrorMessage(error),
    };
  }
  try {
    await params.after?.(result);
  } catch {
    // Compaction hook failures must not turn a completed agent response into a failed run.
  }
  return {
    ...result,
    sessionId: result.result?.sessionId ?? params.sessionId,
    sessionFile: result.result?.sessionFile ?? params.sessionFile,
  };
}
