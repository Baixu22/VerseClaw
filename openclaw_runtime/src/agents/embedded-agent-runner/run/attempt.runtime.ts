import { flushRuntimeCompileCache } from "../../../infra/runtime-compile-cache.js";
export { runEmbeddedAttempt } from "./attempt.js";

// Harness metadata leaves this graph unloaded. Persist it before execution can be interrupted.
flushRuntimeCompileCache();
