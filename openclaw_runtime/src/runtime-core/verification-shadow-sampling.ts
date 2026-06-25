export type RuntimeVerificationShadowSampleSource =
  | "tools.invoke"
  | "security.policy.simulate"
  | "verification.run";

export type RuntimeVerificationShadowSampleTrigger =
  | "gateway-rpc"
  | "tools-invoke"
  | "event-log-append"
  | "checkpoint-serialize";

export type RuntimeVerificationShadowSamplingOptions =
  | boolean
  | {
      enabled?: boolean;
      runId?: string;
      source?: RuntimeVerificationShadowSampleSource;
      trigger?: RuntimeVerificationShadowSampleTrigger;
      storeTrace?: boolean;
    };

export type RuntimeVerificationShadowSampleOptions = {
  enabled: boolean;
  runId?: string;
  source: RuntimeVerificationShadowSampleSource;
  trigger: RuntimeVerificationShadowSampleTrigger;
  storeTrace?: boolean;
};

export type RuntimeVerificationShadowSink = {
  recordEventLog?: (params: {
    events: readonly unknown[];
    runId?: string;
    source: RuntimeVerificationShadowSampleSource;
    trigger: RuntimeVerificationShadowSampleTrigger;
    storeTrace?: boolean;
  }) => void;
  recordCheckpoint?: (params: {
    checkpoint: unknown;
    runId?: string;
    source: RuntimeVerificationShadowSampleSource;
    trigger: RuntimeVerificationShadowSampleTrigger;
    storeTrace?: boolean;
  }) => void;
};

let runtimeVerificationShadowSink: RuntimeVerificationShadowSink | undefined;

export function setRuntimeVerificationShadowSink(
  sink: RuntimeVerificationShadowSink | undefined,
): () => void {
  const previous = runtimeVerificationShadowSink;
  runtimeVerificationShadowSink = sink;
  return () => {
    runtimeVerificationShadowSink = previous;
  };
}

export function getRuntimeVerificationShadowSink(): RuntimeVerificationShadowSink | undefined {
  return runtimeVerificationShadowSink;
}

export function resolveRuntimeVerificationShadowSamplingOptions(
  value: RuntimeVerificationShadowSamplingOptions | undefined,
  fallbackRunId?: string,
  fallbackTrigger: RuntimeVerificationShadowSampleTrigger = "gateway-rpc",
): RuntimeVerificationShadowSampleOptions {
  if (value === true) {
    return {
      enabled: true,
      ...(fallbackRunId ? { runId: fallbackRunId } : {}),
      source: "verification.run",
      trigger: fallbackTrigger,
    };
  }
  if (value === false || value === undefined) {
    return { enabled: false, source: "verification.run", trigger: fallbackTrigger };
  }
  return {
    enabled: value.enabled === true,
    runId: normalizeString(value.runId) ?? fallbackRunId,
    source: value.source ?? "verification.run",
    trigger: value.trigger ?? fallbackTrigger,
    ...(value.storeTrace !== undefined ? { storeTrace: value.storeTrace } : {}),
  };
}

export function emitRuntimeEventLogVerificationShadowSample(params: {
  sampling?: RuntimeVerificationShadowSamplingOptions;
  events: readonly unknown[];
  fallbackRunId?: string;
  fallbackTrigger?: RuntimeVerificationShadowSampleTrigger;
}): void {
  const options = resolveRuntimeVerificationShadowSamplingOptions(
    params.sampling,
    params.fallbackRunId,
    params.fallbackTrigger ?? "event-log-append",
  );
  if (!options.enabled || params.events.length === 0) return;
  try {
    runtimeVerificationShadowSink?.recordEventLog?.({
      events: params.events,
      ...(options.runId ? { runId: options.runId } : {}),
      source: options.source,
      trigger: options.trigger,
      ...(options.storeTrace !== undefined ? { storeTrace: options.storeTrace } : {}),
    });
  } catch {
    // Verification auto-sampling is observe-only and must not perturb runtime behavior.
  }
}

export function emitRuntimeCheckpointVerificationShadowSample(params: {
  sampling?: RuntimeVerificationShadowSamplingOptions;
  checkpoint: unknown;
  fallbackRunId?: string;
  fallbackTrigger?: RuntimeVerificationShadowSampleTrigger;
}): void {
  const options = resolveRuntimeVerificationShadowSamplingOptions(
    params.sampling,
    params.fallbackRunId,
    params.fallbackTrigger ?? "checkpoint-serialize",
  );
  if (!options.enabled) return;
  try {
    runtimeVerificationShadowSink?.recordCheckpoint?.({
      checkpoint: params.checkpoint,
      ...(options.runId ? { runId: options.runId } : {}),
      source: options.source,
      trigger: options.trigger,
      ...(options.storeTrace !== undefined ? { storeTrace: options.storeTrace } : {}),
    });
  } catch {
    // Verification auto-sampling is observe-only and must not perturb runtime behavior.
  }
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 256) : undefined;
}
