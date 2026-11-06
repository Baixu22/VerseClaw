export interface TraceReproducer {
  kind: 'scenario' | 'route' | 'command-id';
  ref: string | number;
}

export interface TraceInput {
  runId: string;
  createdAt: string;
  outcome: 'failure' | 'success' | 'refusal' | 'refused' | 'cancelled' | 'canceled';
  reproducer: TraceReproducer;
  signature: string;
  attempt?: number;
  [key: string]: unknown;
}

export interface TraceDiagnostic {
  code: string;
  message?: string;
}

export interface EvalSample {
  sourceRunId: string;
  expected: {
    'before-fix': 'fail' | 'pass';
    'after-fix': 'pass';
  };
  reproducer: TraceReproducer;
  selector: {
    runId: string;
    attempt: number;
  };
  digest: string;
}

export interface RejectedTrace {
  runId: string | null;
  diagnostics: TraceDiagnostic[];
}

export interface TraceToEvalSampleResult {
  ok: true;
  sample: EvalSample;
}

export interface TraceToEvalSampleError {
  ok: false;
  diagnostics: TraceDiagnostic[];
}

export function traceToEvalSample(trace: TraceInput): TraceToEvalSampleResult | TraceToEvalSampleError;

export function traceToEvalSamples(traces: TraceInput[]): {
  samples: EvalSample[];
  rejected: RejectedTrace[];
};

export default traceToEvalSamples;
