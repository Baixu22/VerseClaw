import { z, type ZodIssue } from "zod";
import type {
  TrajectoryEvent,
  TrajectoryEventV2,
  TrajectoryEventV2Type,
  TrajectoryReadableEvent,
} from "./types.js";

const trajectoryIdSchema = z.string().trim().min(1);
const trajectoryTimestampSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: "must be an ISO-compatible timestamp",
});
const trajectoryJsonObjectSchema = z.record(z.string(), z.json());

export const TrajectoryEventV1Schema = z
  .object({
    traceSchema: z.literal("openclaw-trajectory"),
    schemaVersion: z.literal(1),
    traceId: trajectoryIdSchema,
    source: z.enum(["runtime", "transcript", "export"]),
    type: z.string().min(1),
    ts: trajectoryTimestampSchema,
    seq: z.number().finite(),
    sourceSeq: z.number().finite().optional(),
    sessionId: trajectoryIdSchema,
    sessionKey: z.string().optional(),
    runId: z.string().optional(),
    workspaceDir: z.string().optional(),
    provider: z.string().optional(),
    modelId: z.string().optional(),
    modelApi: z.string().nullable().optional(),
    entryId: z.string().optional(),
    parentEntryId: z.string().nullable().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const trajectoryEventV2BaseSchema = z
  .object({
    traceSchema: z.literal("openclaw-trajectory"),
    schemaVersion: z.literal(2),
    traceId: trajectoryIdSchema,
    source: z.enum(["runtime", "transcript", "export"]),
    ts: trajectoryTimestampSchema,
    seq: z.number().int().positive(),
    type: z.enum([
      "run/start",
      "run/end",
      "turn/start",
      "turn/end",
      "step/start",
      "step/end",
      "tool/start",
      "tool/update",
      "tool/end",
    ]),
    role: z.enum(["run", "turn", "step", "tool"]),
    phase: z.enum(["start", "update", "end"]),
    runId: trajectoryIdSchema,
    loopRunId: trajectoryIdSchema.optional(),
    turnId: trajectoryIdSchema.optional(),
    stepId: trajectoryIdSchema.optional(),
    toolCallId: trajectoryIdSchema.optional(),
    state: trajectoryJsonObjectSchema,
    data: trajectoryJsonObjectSchema.optional(),
  })
  .strict();

function addIssue(ctx: z.RefinementCtx, path: string[], message: string): void {
  ctx.addIssue({ code: "custom", path, message });
}

export const TrajectoryEventV2Schema = trajectoryEventV2BaseSchema.superRefine((event, ctx) => {
  const expectedType = `${event.role}/${event.phase}` as TrajectoryEventV2Type;
  if (event.type !== expectedType) {
    addIssue(ctx, ["type"], `must be ${expectedType} for the declared lifecycle role and phase`);
  }
  if (event.phase === "update" && event.role !== "tool") {
    addIssue(ctx, ["phase"], "only tool events support the update phase");
  }

  if (event.role === "run") {
    if (event.turnId || event.stepId || event.toolCallId) {
      addIssue(ctx, [], "run events cannot carry turn, step, or tool ids");
    }
    return;
  }
  if (!event.turnId) {
    addIssue(ctx, ["turnId"], "is required for turn, step, and tool events");
  }
  if (event.role === "turn") {
    if (event.stepId || event.toolCallId) {
      addIssue(ctx, [], "turn events cannot carry step or tool ids");
    }
    return;
  }
  if (!event.stepId) {
    addIssue(ctx, ["stepId"], "is required for step and tool events");
  }
  if (event.role === "step") {
    if (event.toolCallId) {
      addIssue(ctx, ["toolCallId"], "step events cannot carry a tool id");
    }
    return;
  }
  if (!event.toolCallId) {
    addIssue(ctx, ["toolCallId"], "is required for tool events");
  }
});

export type TrajectoryEventParseResult =
  | { success: true; version: 1; event: TrajectoryEvent }
  | { success: true; version: 2; event: TrajectoryEventV2 }
  | { success: false; issues: ZodIssue[] };

export type TrajectoryEventV2ParseResult =
  | { success: true; event: TrajectoryEventV2 }
  | { success: false; issues: ZodIssue[] };

export class TrajectoryEventValidationError extends Error {
  constructor(public readonly issues: readonly ZodIssue[]) {
    super("Invalid trajectory event");
    this.name = "TrajectoryEventValidationError";
  }
}

export function safeParseTrajectoryEventV2(value: unknown): TrajectoryEventV2ParseResult {
  const result = TrajectoryEventV2Schema.safeParse(value);
  return result.success
    ? { success: true, event: result.data as TrajectoryEventV2 }
    : { success: false, issues: result.error.issues };
}

export function safeParseTrajectoryEvent(value: unknown): TrajectoryEventParseResult {
  const v2 = safeParseTrajectoryEventV2(value);
  if (v2.success) {
    return { success: true, version: 2, event: v2.event };
  }
  const v1 = TrajectoryEventV1Schema.safeParse(value);
  if (v1.success) {
    return { success: true, version: 1, event: v1.data as TrajectoryEvent };
  }
  return {
    success: false,
    issues: [...v2.issues, ...v1.error.issues],
  };
}

export function parseTrajectoryEvent(value: unknown): TrajectoryReadableEvent {
  const result = safeParseTrajectoryEvent(value);
  if (!result.success) {
    throw new TrajectoryEventValidationError(result.issues);
  }
  return result.event;
}

export function parseSerializedTrajectoryEvent(serialized: string): TrajectoryReadableEvent {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new TrajectoryEventValidationError([
      {
        code: "custom",
        path: [],
        message: "trajectory event is not valid JSON",
      },
    ]);
  }
  return parseTrajectoryEvent(value);
}

export function serializeTrajectoryEvent(event: TrajectoryReadableEvent): string {
  return JSON.stringify(parseTrajectoryEvent(event));
}

export function isTrajectoryEvent(value: unknown): value is TrajectoryReadableEvent {
  return safeParseTrajectoryEvent(value).success;
}
