// Runtime barrel for attempt execution. Kept separate so callers can import the
// light shared helpers without pulling the full command attempt graph.
import { flushRuntimeCompileCache } from "../../infra/runtime-compile-cache.js";
export {
  buildAcpResult,
  createAcpVisibleTextAccumulator,
  emitAcpAssistantDelta,
  emitAcpLifecycleEnd,
  emitAcpLifecycleError,
  emitAcpLifecycleStart,
  emitAcpPromptSubmitted,
  emitAcpRuntimeEvent,
  persistAcpTurnTranscript,
  persistCliTurnTranscript,
  runAgentAttempt,
  sessionFileHasContent,
} from "./attempt-execution.js";

// This graph can load after the startup flush. Persist it before a turn reaches
// an interruptible boundary so killed utility processes can reuse its bytecode.
flushRuntimeCompileCache();
