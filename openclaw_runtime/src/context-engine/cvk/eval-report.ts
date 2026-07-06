export type CvkBenchmarkKind =
  | 'tool_schema'
  | 'skill_routing'
  | 'project_rule'
  | 'codebase'
  | 'compact_recovery';

export type CvkMetricName =
  | 'TSR'
  | 'CRR'
  | 'SC'
  | 'SS'
  | 'AR'
  | 'RRR'
  | 'HCR'
  | 'UCR'
  | 'ERR'
  | 'RFS'
  | 'ToolCallValidity';

export type CvkMetricMap = Record<CvkMetricName, number>;

export type CvkBenchmarkResult = {
  id: string;
  benchmark: CvkBenchmarkKind;
  metrics: CvkMetricMap;
  failures: string[];
};

export type CvkGeneratedArtifact = {
  path: string;
  content: string;
};

export type CvkSecretFinding = {
  path: string;
  kind: 'openai_key' | 'aws_access_key' | 'generic_secret';
  match: string;
};

export type CvkGateDecision = {
  status: 'pass' | 'blocked';
  reason: 'passed' | 'secret_scan_failed' | 'benchmark_coverage_missing' | 'evidence_metrics_below_threshold' | 'token_savings_below_threshold';
  nextAllowedAction?: 'active_pilot' | 'default_on_candidate' | 'strict_rollout_candidate';
  failedMetrics: Array<{
    metric: CvkMetricName;
    actual: number;
    threshold: number;
  }>;
};

export type CvkEvalReport = {
  benchmarks: CvkBenchmarkResult[];
  averages: CvkMetricMap;
  worstCases: CvkMetricMap;
  worstCaseFailures: Array<{
    id: string;
    benchmark: CvkBenchmarkKind;
    failures: string[];
  }>;
  acceptanceGateSummaries: Array<{
    benchmark: CvkBenchmarkKind;
    status: 'pass' | 'fail';
    failures: string[];
  }>;
  secretScan: {
    passed: boolean;
    findings: CvkSecretFinding[];
  };
  gateDecisions: {
    level1: CvkGateDecision;
    level2: CvkGateDecision;
    level3: CvkGateDecision;
  };
  evidencePriority: {
    tokenSavingsCannotOverrideEvidenceLoss: true;
    blockedByEvidenceLoss: boolean;
  };
};

export type CvkEvalReportInput = {
  benchmarks: CvkBenchmarkResult[];
  generatedArtifacts: CvkGeneratedArtifact[];
};

const REQUIRED_BENCHMARKS: CvkBenchmarkKind[] = [
  'tool_schema',
  'skill_routing',
  'project_rule',
  'codebase',
  'compact_recovery',
];

const METRICS: CvkMetricName[] = [
  'TSR',
  'CRR',
  'SC',
  'SS',
  'AR',
  'RRR',
  'HCR',
  'UCR',
  'ERR',
  'RFS',
  'ToolCallValidity',
];

const LOWER_IS_BETTER = new Set<CvkMetricName>(['UCR']);
const TOKEN_METRICS = new Set<CvkMetricName>(['TSR', 'CRR']);

const LEVEL_THRESHOLDS = {
  level1: {
    TSR: 0.4,
    CRR: 0.6,
    SC: 0.99,
    RRR: 0.99,
    HCR: 0.95,
    ERR: 0.95,
    RFS: 0.9,
    ToolCallValidity: 0.95,
  },
  level2: {
    TSR: 0.6,
    CRR: 0.8,
    SC: 1,
    SS: 1,
    AR: 1,
    RRR: 1,
    HCR: 0.98,
    UCR: 0.01,
    ERR: 1,
    RFS: 0.95,
    ToolCallValidity: 0.98,
  },
  level3: {
    TSR: 0.7,
    CRR: 0.9,
    SC: 1,
    SS: 1,
    AR: 1,
    RRR: 1,
    HCR: 1,
    UCR: 0.005,
    ERR: 1,
    RFS: 0.98,
    ToolCallValidity: 0.99,
  },
} as const satisfies Record<string, Partial<CvkMetricMap>>;

export function calculateRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

export function calculateTokenSavingRate(baselineTokens: number, cvkTokens: number): number {
  if (baselineTokens <= 0) return 0;
  return Math.round((1 - (cvkTokens / baselineTokens)) * 10_000) / 10_000;
}

export function scanGeneratedArtifactSecrets(artifacts: CvkGeneratedArtifact[]): CvkSecretFinding[] {
  const patterns: Array<{ kind: CvkSecretFinding['kind']; pattern: RegExp }> = [
    { kind: 'openai_key', pattern: /(sk-(?:proj-)?[A-Za-z0-9_-]{20,})/g },
    { kind: 'openai_key', pattern: /OPENAI_API_KEY\s*=\s*(sk-(?:proj-)?[A-Za-z0-9_-]{20,})/g },
    { kind: 'aws_access_key', pattern: /(AKIA[0-9A-Z]{16})/g },
    { kind: 'generic_secret', pattern: /(SECRET[_A-Z0-9]*\s*=\s*[A-Za-z0-9_-]{24,})/g },
  ];
  const findings = artifacts.flatMap((artifact) => (
    patterns.flatMap(({ kind, pattern }) => (
      [...artifact.content.matchAll(pattern)].map((match) => ({
        path: artifact.path,
        kind,
        match: match[1] ?? match[0],
      }))
    ))
  ));
  return [...new Map(findings.map((finding) => [
    `${finding.path}\u0000${finding.kind}\u0000${finding.match}`,
    finding,
  ])).values()];
}

function averageMetric(benchmarks: CvkBenchmarkResult[], metric: CvkMetricName): number {
  if (benchmarks.length === 0) return 0;
  return Math.round((benchmarks.reduce((total, benchmark) => total + benchmark.metrics[metric], 0) / benchmarks.length) * 10_000) / 10_000;
}

function worstMetric(benchmarks: CvkBenchmarkResult[], metric: CvkMetricName): number {
  if (benchmarks.length === 0) return 0;
  const values = benchmarks.map((benchmark) => benchmark.metrics[metric]);
  return LOWER_IS_BETTER.has(metric) ? Math.max(...values) : Math.min(...values);
}

function metricPasses(metric: CvkMetricName, actual: number, threshold: number): boolean {
  return LOWER_IS_BETTER.has(metric) ? actual <= threshold : actual >= threshold;
}

function missingBenchmarks(benchmarks: CvkBenchmarkResult[]): CvkBenchmarkKind[] {
  const present = new Set(benchmarks.map((benchmark) => benchmark.benchmark));
  return REQUIRED_BENCHMARKS.filter((benchmark) => !present.has(benchmark));
}

function decideGate(params: {
  level: keyof typeof LEVEL_THRESHOLDS;
  worstCases: CvkMetricMap;
  secretFindings: CvkSecretFinding[];
  missing: CvkBenchmarkKind[];
}): CvkGateDecision {
  const thresholds = LEVEL_THRESHOLDS[params.level];
  const failedMetrics = Object.entries(thresholds).flatMap(([metric, threshold]) => {
    const metricName = metric as CvkMetricName;
    const actual = params.worstCases[metricName];
    return metricPasses(metricName, actual, threshold)
      ? []
      : [{ metric: metricName, actual, threshold }];
  });

  if (params.secretFindings.length > 0) {
    return { status: 'blocked', reason: 'secret_scan_failed', failedMetrics };
  }
  if (params.missing.length > 0) {
    return { status: 'blocked', reason: 'benchmark_coverage_missing', failedMetrics };
  }
  const evidenceFailures = failedMetrics.filter((failure) => !TOKEN_METRICS.has(failure.metric));
  if (evidenceFailures.length > 0) {
    return { status: 'blocked', reason: 'evidence_metrics_below_threshold', failedMetrics };
  }
  if (failedMetrics.length > 0) {
    return { status: 'blocked', reason: 'token_savings_below_threshold', failedMetrics };
  }

  const nextAllowedAction = params.level === 'level1'
    ? 'active_pilot'
    : params.level === 'level2'
      ? 'default_on_candidate'
      : 'strict_rollout_candidate';
  return {
    status: 'pass',
    reason: 'passed',
    nextAllowedAction,
    failedMetrics: [],
  };
}

export function buildCvkEvalReport(input: CvkEvalReportInput): CvkEvalReport {
  const averages = Object.fromEntries(METRICS.map((metric) => [metric, averageMetric(input.benchmarks, metric)])) as CvkMetricMap;
  const worstCases = Object.fromEntries(METRICS.map((metric) => [metric, worstMetric(input.benchmarks, metric)])) as CvkMetricMap;
  const secretFindings = scanGeneratedArtifactSecrets(input.generatedArtifacts);
  const missing = missingBenchmarks(input.benchmarks);
  const gateDecisions = {
    level1: decideGate({ level: 'level1', worstCases, secretFindings, missing }),
    level2: decideGate({ level: 'level2', worstCases, secretFindings, missing }),
    level3: decideGate({ level: 'level3', worstCases, secretFindings, missing }),
  };
  const worstCaseFailures = input.benchmarks
    .filter((benchmark) => benchmark.failures.length > 0)
    .map((benchmark) => ({
      id: benchmark.id,
      benchmark: benchmark.benchmark,
      failures: benchmark.failures,
    }));
  const acceptanceGateSummaries = REQUIRED_BENCHMARKS.map((benchmark) => {
    const matching = input.benchmarks.filter((item) => item.benchmark === benchmark);
    if (matching.length === 0) {
      return {
        benchmark,
        status: 'fail' as const,
        failures: [`Required benchmark ${benchmark} was not provided.`],
      };
    }
    const failures = matching.flatMap((item) => item.failures);
    return {
      benchmark,
      status: failures.length === 0 ? 'pass' as const : 'fail' as const,
      failures,
    };
  });
  const evidencePriorityFailures = gateDecisions.level1.failedMetrics
    .filter((failure) => !TOKEN_METRICS.has(failure.metric));

  return {
    benchmarks: input.benchmarks,
    averages,
    worstCases,
    worstCaseFailures,
    acceptanceGateSummaries,
    secretScan: {
      passed: secretFindings.length === 0,
      findings: secretFindings,
    },
    gateDecisions,
    evidencePriority: {
      tokenSavingsCannotOverrideEvidenceLoss: true,
      blockedByEvidenceLoss: evidencePriorityFailures.length > 0,
    },
  };
}
