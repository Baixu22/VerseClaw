/**
 * Terminal signalling for critical tool-call loops.
 *
 * The loop detector can only veto an individual tool call. Returning the veto as a
 * regular blocked tool result leaves the agent turn alive, so a model that keeps
 * re-issuing the same call spins until the operator stops the run by hand
 * (observed in the 2026-09-11 live CDP corpus, session s05-t01: 43 identical
 * `read` calls after the guard first fired). Hosts that own the run lifecycle use
 * the observer below to end the turn instead of only blocking the call.
 */

/** Facts about a critical tool-loop veto that is ending the run. */
export type ToolLoopTerminationInfo = {
  toolName: string;
  detector: string;
  count: number;
  message: string;
};

/** Host callback invoked when a critical tool-loop veto terminates the turn. */
export type ToolLoopTerminationObserver = (info: ToolLoopTerminationInfo) => void;

/**
 * Error raised when a critical tool-loop veto ends the run.
 *
 * Mirrors `PostCompactionLoopPersistedError`: the abort signal carries this error
 * so the run loop can rethrow it after the attempt settles instead of treating the
 * turn as a caller-initiated abort.
 */
export class ToolLoopTerminatedError extends Error {
  readonly detector: string;
  readonly toolName: string;
  readonly count: number;

  constructor(info: ToolLoopTerminationInfo) {
    super(info.message);
    this.name = "ToolLoopTerminatedError";
    this.detector = info.detector;
    this.toolName = info.toolName;
    this.count = info.count;
  }
}
