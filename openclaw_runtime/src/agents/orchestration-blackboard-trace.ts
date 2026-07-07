import type {
  BlackboardEntry,
  BlackboardState,
  BlackboardValidationIssue,
} from "./orchestration-blackboard.js";
import {
  appendBlackboardEntry,
  createBlackboardState,
  detectBlackboardConflicts,
  updateBlackboardEntry,
} from "./orchestration-blackboard.js";

type BlackboardAppendTraceEvent = {
  sequence: number;
  kind: "append";
  occurredAt: string;
  entry: Omit<BlackboardEntry, "version" | "createdAt" | "updatedAt">;
};

type BlackboardUpdateTraceEvent = {
  sequence: number;
  kind: "update";
  occurredAt: string;
  entryId: string;
  patch: Partial<Pick<BlackboardEntry, "content" | "confidence" | "evidenceRefs" | "visibility" | "status">>;
};

type BlackboardConflictTraceEvent = {
  sequence: number;
  kind: "conflict";
  occurredAt: string;
};

export type BlackboardTraceEvent =
  | BlackboardAppendTraceEvent
  | BlackboardUpdateTraceEvent
  | BlackboardConflictTraceEvent;

export type BlackboardTraceReplayResult = {
  state: BlackboardState;
  issues: BlackboardValidationIssue[];
};

function eventIssue(event: BlackboardTraceEvent, issue: BlackboardValidationIssue): BlackboardValidationIssue {
  return {
    path: `events.${event.sequence}.${issue.path}`,
    message: issue.message,
  };
}

export function replayBlackboardTrace(
  events: readonly BlackboardTraceEvent[],
  knownRoleNames: readonly string[],
): BlackboardTraceReplayResult {
  let state = createBlackboardState();
  const issues: BlackboardValidationIssue[] = [];

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.kind === "append") {
      const result = appendBlackboardEntry(state, event.entry, knownRoleNames, event.occurredAt);
      issues.push(...result.issues.map((entryIssue) => eventIssue(event, entryIssue)));
      state = result.state;
      continue;
    }
    if (event.kind === "update") {
      const result = updateBlackboardEntry(state, event.entryId, event.patch, knownRoleNames, event.occurredAt);
      issues.push(...result.issues.map((entryIssue) => eventIssue(event, entryIssue)));
      state = result.state;
      continue;
    }
    const result = detectBlackboardConflicts(state, knownRoleNames, event.occurredAt);
    issues.push(...result.issues.map((entryIssue) => eventIssue(event, entryIssue)));
    state = result.state;
  }

  return { state, issues };
}
