// Shared trajectory support-bundle schema. Runtime, transcript, and export code
// all emit this versioned JSONL shape so external debugging tools can replay it.
export type TrajectoryEventSource = "runtime" | "transcript" | "export";

// Serialized tool definition captured with compiled context events.
export type TrajectoryToolDefinition = {
  name: string;
  description?: string;
  parameters?: unknown;
};

// Versioned event envelope for runtime and transcript-derived trajectory rows.
export type TrajectoryEvent = {
  traceSchema: "openclaw-trajectory";
  schemaVersion: 1;
  traceId: string;
  source: TrajectoryEventSource;
  type: string;
  ts: string;
  seq: number;
  sourceSeq?: number;
  sessionId: string;
  sessionKey?: string;
  runId?: string;
  workspaceDir?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  entryId?: string;
  parentEntryId?: string | null;
  data?: Record<string, unknown>;
};

export type TrajectoryJsonValue =
  | null
  | boolean
  | number
  | string
  | TrajectoryJsonValue[]
  | { [key: string]: TrajectoryJsonValue };

export type TrajectoryLifecycleRole = "run" | "turn" | "step" | "tool";
export type TrajectoryLifecyclePhase = "start" | "update" | "end";
export type TrajectoryEventV2Type =
  | "run/start"
  | "run/end"
  | "turn/start"
  | "turn/end"
  | "step/start"
  | "step/end"
  | "tool/start"
  | "tool/update"
  | "tool/end";

type TrajectoryEventV2Common = {
  traceSchema: "openclaw-trajectory";
  schemaVersion: 2;
  traceId: string;
  source: TrajectoryEventSource;
  ts: string;
  seq: number;
  type: TrajectoryEventV2Type;
  role: TrajectoryLifecycleRole;
  phase: TrajectoryLifecyclePhase;
  runId: string;
  loopRunId?: string;
  state: Record<string, TrajectoryJsonValue>;
  data?: Record<string, TrajectoryJsonValue>;
};

export type TrajectoryEventV2 =
  | (TrajectoryEventV2Common & {
      type: "run/start" | "run/end";
      role: "run";
      phase: "start" | "end";
      turnId?: never;
      stepId?: never;
      toolCallId?: never;
    })
  | (TrajectoryEventV2Common & {
      type: "turn/start" | "turn/end";
      role: "turn";
      phase: "start" | "end";
      turnId: string;
      stepId?: never;
      toolCallId?: never;
    })
  | (TrajectoryEventV2Common & {
      type: "step/start" | "step/end";
      role: "step";
      phase: "start" | "end";
      turnId: string;
      stepId: string;
      toolCallId?: never;
    })
  | (TrajectoryEventV2Common & {
      type: "tool/start" | "tool/update" | "tool/end";
      role: "tool";
      phase: TrajectoryLifecyclePhase;
      turnId: string;
      stepId: string;
      toolCallId: string;
    });

export type TrajectoryReadableEvent = TrajectoryEvent | TrajectoryEventV2;

// Bundle manifest written beside events.jsonl in trajectory exports.
export type TrajectoryBundleManifest = {
  traceSchema: "openclaw-trajectory";
  schemaVersion: 1;
  generatedAt: string;
  traceId: string;
  sessionId: string;
  sessionKey?: string;
  workspaceDir: string;
  leafId: string | null;
  eventCount: number;
  runtimeEventCount: number;
  transcriptEventCount: number;
  sourceFiles: {
    session: string;
    runtime?: string;
  };
  contents?: Array<{
    path: string;
    mediaType: string;
    bytes: number;
  }>;
  supplementalFiles?: string[];
  warnings?: TrajectoryBundleWarning[];
};

// Parse/export warnings are grouped in the manifest with sample row numbers.
export type TrajectoryBundleWarning = {
  source: "session" | "runtime";
  code:
    | "invalid-session-json"
    | "invalid-session-row"
    | "incomplete-session-branch"
    | "cyclic-session-branch"
    | "invalid-runtime-json"
    | "invalid-runtime-event";
  count: number;
  rows: number[];
  message: string;
};
