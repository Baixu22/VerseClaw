/** Structured, secret-free evidence for the live prompt-cache regression gate. */
import { LIVE_CACHE_REGRESSION_BASELINE } from "./live-cache-regression-baseline.js";

export type LiveCacheRegressionSummary = Record<string, Record<string, unknown>>;

export type LiveCacheRegressionGateReport = {
  schemaVersion: 1;
  generatedAt: string;
  measured: boolean;
  threshold: typeof LIVE_CACHE_REGRESSION_BASELINE;
  perTurn: LiveCacheRegressionSummary | null;
  promptCache: LiveCacheRegressionSummary | null;
  result: {
    measured: boolean;
    passed: boolean;
    regressions: string[];
    warnings: string[];
  };
  artifactSafety: {
    apiKeyCaptured: false;
  };
};

/** Build the CI artifact payload without ever reading or copying provider keys. */
export function buildLiveCacheRegressionGateReport(params: {
  measured: boolean;
  summary?: LiveCacheRegressionSummary | null;
  regressions?: string[];
  warnings?: string[];
  generatedAt?: string;
}): LiveCacheRegressionGateReport {
  const regressions = [...(params.regressions ?? [])];
  const warnings = [...(params.warnings ?? [])];
  const summary = params.summary ?? null;
  return {
    schemaVersion: 1,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    measured: params.measured,
    threshold: LIVE_CACHE_REGRESSION_BASELINE,
    perTurn: summary,
    promptCache: summary,
    result: {
      measured: params.measured,
      passed: params.measured && regressions.length === 0,
      regressions,
      warnings,
    },
    artifactSafety: {
      apiKeyCaptured: false,
    },
  };
}
