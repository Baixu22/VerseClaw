import { createHash, randomBytes } from "node:crypto";
import type { PermissionApprovalEvent } from "@shared/types/workspace";
import {
  createHostTraceDiagnosticsAuthority,
  type HostIssuedTraceEnvelope,
  type TraceDiagnosticSummary,
} from "../../openclaw_runtime/src/observability/host-trace-diagnostics";

export const MAX_HOST_TRACE_DIAGNOSTICS_RECORDS = 200;

export type HostTraceDiagnosticsEvidence = Readonly<{
  phase?: 'compile' | 'test' | 'tool' | 'permission' | 'environment' | 'runtime';
  code?: string;
  exitCode?: number;
  signal?: string;
  durationMs?: number;
  timedOut?: boolean;
  cancelled?: boolean;
}>;

export type HostTraceDiagnosticsRecord = Readonly<{
  envelope: HostIssuedTraceEnvelope;
  summary: TraceDiagnosticSummary;
}>;

export type HostTraceDiagnosticsSummaryConsumer = (summary: TraceDiagnosticSummary) => void;

export type HostTraceDiagnosticsService = Readonly<{
  record(input: {
    approval: PermissionApprovalEvent;
    evidence?: HostTraceDiagnosticsEvidence;
  }): HostTraceDiagnosticsRecord | undefined;
  records(): readonly HostTraceDiagnosticsRecord[];
  reset(): void;
}>;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomTraceId(): string {
  return randomBytes(16).toString("hex");
}

function randomSpanId(): string {
  return randomBytes(8).toString("hex");
}

function approvalLineage(approval: PermissionApprovalEvent) {
  const correlationSource = approval.requestHash?.trim() || `${approval.id}:${approval.source}`;
  return {
    requestId: approval.id,
    traceId: randomTraceId(),
    spanId: randomSpanId(),
    ...(approval.runId ? { runId: approval.runId } : {}),
    correlationDigest: sha256Hex(correlationSource),
  };
}

export function createHostTraceDiagnosticsService(options: {
  secret?: Uint8Array;
  capacity?: number;
  onSummary?: HostTraceDiagnosticsSummaryConsumer;
} = {}): HostTraceDiagnosticsService {
  const secret = options.secret ?? randomBytes(32);
  const requestedCapacity = options.capacity;
  const capacity = requestedCapacity === undefined
    ? MAX_HOST_TRACE_DIAGNOSTICS_RECORDS
    : Number.isSafeInteger(requestedCapacity)
      ? Math.max(1, Math.min(requestedCapacity, MAX_HOST_TRACE_DIAGNOSTICS_RECORDS))
      : MAX_HOST_TRACE_DIAGNOSTICS_RECORDS;
  const authority = createHostTraceDiagnosticsAuthority(secret);
  const sink: HostTraceDiagnosticsRecord[] = [];

  return {
    record({ approval, evidence }) {
      if (approval.status !== "approved" || approval.source !== "terminal") return undefined;

      const envelope = authority.issue(approvalLineage(approval));
      const summary = authority.summarize(envelope, evidence ?? {});
      if (!summary) return undefined;

      const record = Object.freeze({ envelope, summary });
      sink.push(record);
      if (sink.length > capacity) sink.shift();
      try {
        options.onSummary?.(summary);
      } catch {
        // A diagnostic consumer must never change terminal execution behavior.
      }
      return record;
    },
    records() {
      return [...sink];
    },
    reset() {
      sink.length = 0;
    },
  };
}
