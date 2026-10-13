export const TRACE_TO_EVAL_SCHEMA: "clawx.trace-to-eval.v1";
export type TraceOutcome = "failure" | "success" | "refusal" | "cancelled";
export type TraceReproducer = { kind: "scenario" | "route" | "command-id"; ref: string };
export type RedactedFailureTrace = {
  runId: string;
  createdAt: string;
  outcome: TraceOutcome;
  reproducer: TraceReproducer;
  signature: string;
  attempt?: number;
};
export type EvalSample = {
  schema: typeof TRACE_TO_EVAL_SCHEMA;
  id: string;
  sourceRunId: string;
  createdAt: string;
  sourceOutcome: TraceOutcome;
  expected: { "before-fix": "pass" | "fail"; "after-fix": "pass" | "fail" };
  reproducer: TraceReproducer;
  selector: { runId: string; attempt: number };
  digest: string;
};
export type EvalSampleDiagnostic = { code: string; message: string };
export function traceToEvalSample(trace: unknown): { ok: true; sample: EvalSample; diagnostics: [] } | { ok: false; diagnostics: EvalSampleDiagnostic[] };
export function traceToEvalSamples(traces: readonly unknown[]): { schema: typeof TRACE_TO_EVAL_SCHEMA; samples: EvalSample[]; rejected: Array<{ runId: string | null; diagnostics: EvalSampleDiagnostic[] }> };