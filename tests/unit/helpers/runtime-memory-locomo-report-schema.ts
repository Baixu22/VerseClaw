type UnknownRecord = Record<string, unknown>;

const REQUIRED_TOP_LEVEL_FIELDS = [
  "dataset",
  "version",
  "totalQuestions",
  "retrievalMode",
  "judgeModel",
  "judgeConfig",
  "metric",
  "sampleSizes",
  "sampleSeed",
  "metrics",
  "errorTaxonomy",
  "escalation",
  "extraction",
  "cost",
  "comparison",
  "sampleResults",
  "judgeSanityCandidates",
  "generatedAt",
] as const;

const REQUIRED_OVERALL_METRICS = [
  "j_score",
  "recall_at_5",
  "context_recall",
  "escalation_rate",
  "cost_per_run_estimate_usd",
] as const;

const REQUIRED_CATEGORY_METRICS = [
  "j_score",
  "recall_at_5",
  "context_recall",
  "count",
] as const;

const ERROR_TAXONOMY_BUCKETS = [
  "not_retrieved",
  "retrieved_not_used",
  "used_but_misreasoned",
  "judge_error",
] as const;

const REQUIRED_SAMPLE_RESULT_FIELDS = [
  "questionId",
  "category",
  "conversationId",
  "question",
  "goldEvidence",
  "recall5",
  "contextRecall",
  "judgeScore",
  "escalationLevel",
  "predictedAnswer",
  "groundTruth",
  "assembledContext",
] as const;

export function assertLocomoStageReportShape(report: unknown): void {
  const root = expectRecord(report, "report");
  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in root)) {
      throw new Error(`LoCoMo report missing required field: ${field}`);
    }
  }

  if (root.dataset !== "locomo") {
    throw new Error("LoCoMo report dataset must be 'locomo'");
  }
  if (typeof root.version !== "string" || root.version.length === 0) {
    throw new Error("LoCoMo report version must be a non-empty string");
  }
  if (typeof root.totalQuestions !== "number" || root.totalQuestions <= 0) {
    throw new Error("LoCoMo report totalQuestions must be positive");
  }
  if (!Array.isArray(root.sampleResults)) {
    throw new Error("LoCoMo report sampleResults must be an array");
  }
  const expectedSampleCount = Math.min(20, root.totalQuestions as number);
  if (root.sampleResults.length !== expectedSampleCount) {
    throw new Error(
      `LoCoMo report sampleResults must contain ${expectedSampleCount} inspection samples`,
    );
  }
  for (const [index, sample] of root.sampleResults.entries()) {
    assertSampleResultShape(sample, `report.sampleResults[${index}]`);
  }

  if (!Array.isArray(root.judgeSanityCandidates)) {
    throw new Error("LoCoMo report judgeSanityCandidates must be an array");
  }
  if (root.judgeSanityCandidates.length > 50) {
    throw new Error("LoCoMo report judgeSanityCandidates must be capped at 50");
  }
  for (const [index, sample] of root.judgeSanityCandidates.entries()) {
    assertJudgeSanityCandidateShape(
      sample,
      `report.judgeSanityCandidates[${index}]`,
    );
  }

  const metrics = expectRecord(root.metrics, "report.metrics");
  const overall = expectRecord(metrics.overall, "report.metrics.overall");
  for (const field of REQUIRED_OVERALL_METRICS) {
    expectNumber(overall[field], `report.metrics.overall.${field}`);
  }

  const byCategory = expectRecord(metrics.byCategory, "report.metrics.byCategory");
  for (const [category, value] of Object.entries(byCategory)) {
    const categoryMetrics = expectRecord(
      value,
      `report.metrics.byCategory.${category}`,
    );
    for (const field of REQUIRED_CATEGORY_METRICS) {
      expectNumber(
        categoryMetrics[field],
        `report.metrics.byCategory.${category}.${field}`,
      );
    }
  }

  expectRecord(root.comparison, "report.comparison");
  assertJudgeConfigShape(root.judgeConfig);
  assertErrorTaxonomyShape(root.errorTaxonomy);
  assertEscalationShape(root.escalation);
  assertExtractionShape(root.extraction);
  const cost = expectRecord(root.cost, "report.cost");
  expectNumber(cost.estimateUsd, "report.cost.estimateUsd");
  expectNumber(
    cost.projectedFullRunEstimateUsd,
    "report.cost.projectedFullRunEstimateUsd",
  );
  const deepSeekUsage = expectRecord(cost.deepSeekUsage, "report.cost.deepSeekUsage");
  for (const field of ["calls", "promptTokens", "completionTokens", "totalTokens"]) {
    expectNumber(deepSeekUsage[field], `report.cost.deepSeekUsage.${field}`);
  }
}

function assertJudgeConfigShape(value: unknown): void {
  const judgeConfig = expectRecord(value, "report.judgeConfig");
  // Model is configurable via DEEPSEEK_MODEL env var (e.g. deepseek-chat,
  // deepseek-v4-flash, deepseek-reasoner). Accept any non-empty string.
  if (typeof judgeConfig.model !== "string" || judgeConfig.model.length === 0) {
    throw new Error("report.judgeConfig.model must be a non-empty string");
  }
  if (judgeConfig.temperature !== 0) {
    throw new Error("report.judgeConfig.temperature must be 0");
  }
  for (const field of ["promptVersion", "promptTemplate"]) {
    if (typeof judgeConfig[field] !== "string" || judgeConfig[field].length === 0) {
      throw new Error(`report.judgeConfig.${field} must be a non-empty string`);
    }
  }
}

function assertErrorTaxonomyShape(value: unknown): void {
  const taxonomy = expectRecord(value, "report.errorTaxonomy");
  assertBucketCounts(taxonomy.overall, "report.errorTaxonomy.overall");
  const byCategory = expectRecord(
    taxonomy.byCategory,
    "report.errorTaxonomy.byCategory",
  );
  for (const [category, counts] of Object.entries(byCategory)) {
    assertBucketCounts(counts, `report.errorTaxonomy.byCategory.${category}`);
  }
}

function assertBucketCounts(value: unknown, label: string): void {
  const counts = expectRecord(value, label);
  for (const bucket of ERROR_TAXONOMY_BUCKETS) {
    expectNumber(counts[bucket], `${label}.${bucket}`);
  }
}

function assertEscalationShape(value: unknown): void {
  const escalation = expectRecord(value, "report.escalation");
  for (const field of [
    "totalQuestions",
    "level0",
    "level1",
    "level2",
    "capped",
    "fullConversationCapped",
    "maxEscalations",
    "maxFullConversationEscalations",
    "escalationRate",
    "fullConversationRate",
  ]) {
    expectNumber(escalation[field], `report.escalation.${field}`);
  }
}

function assertExtractionShape(value: unknown): void {
  const extraction = expectRecord(value, "report.extraction");
  expectString(extraction.factsCachePath, "report.extraction.factsCachePath");
  for (const field of [
    "cachedConversations",
    "freshConversations",
    "totalChunks",
    "parseFailures",
    "parseSuccessRate",
  ]) {
    expectNumber(extraction[field], `report.extraction.${field}`);
  }
  if (!Array.isArray(extraction.conversations)) {
    throw new Error("report.extraction.conversations must be an array");
  }
  for (const [index, conversation] of extraction.conversations.entries()) {
    assertExtractionConversationShape(
      conversation,
      `report.extraction.conversations[${index}]`,
    );
  }
}

function assertExtractionConversationShape(value: unknown, label: string): void {
  const conversation = expectRecord(value, label);
  expectString(conversation.conversationId, `${label}.conversationId`);
  for (const field of [
    "totalChunks",
    "parseFailures",
    "parseSuccessRate",
    "extractedFacts",
    "uniqueFacts",
  ]) {
    expectNumber(conversation[field], `${label}.${field}`);
  }
}

function assertSampleResultShape(value: unknown, label: string): void {
  const sample = expectRecord(value, label);
  for (const field of REQUIRED_SAMPLE_RESULT_FIELDS) {
    if (!(field in sample)) {
      throw new Error(`${label} missing required field: ${field}`);
    }
  }
  for (const field of ["questionId", "category", "conversationId", "question"]) {
    expectString(sample[field], `${label}.${field}`);
  }
  if (!Array.isArray(sample.goldEvidence)) {
    throw new Error(`${label}.goldEvidence must be an array`);
  }
  for (const field of ["recall5", "contextRecall", "judgeScore", "escalationLevel"]) {
    expectNumber(sample[field], `${label}.${field}`);
  }
  for (const field of ["predictedAnswer", "groundTruth", "assembledContext"]) {
    expectString(sample[field], `${label}.${field}`);
  }
}

function assertJudgeSanityCandidateShape(value: unknown, label: string): void {
  const sample = expectRecord(value, label);
  for (const field of [
    "questionId",
    "category",
    "conversationId",
    "question",
    "groundTruth",
    "predictedAnswer",
  ]) {
    expectString(sample[field], `${label}.${field}`);
  }
  expectNumber(sample.judgeScore, `${label}.judgeScore`);
}

function expectRecord(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function expectNumber(value: unknown, label: string): void {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${label} must be a number`);
  }
}

function expectString(value: unknown, label: string): void {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
}
