import * as nodeModule from "node:module";

/** Persists loaded bytecode for the supervisor's next process. */
export function flushRuntimeCompileCache(): void {
  try {
    // Bun omits this optional Node API; its execution path stays available.
    nodeModule.flushCompileCache?.();
  } catch {
    // Cache storage is optional; startup and agent execution keep their normal path.
  }
}
