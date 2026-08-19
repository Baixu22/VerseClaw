import { readFileSync } from "node:fs";

export const KNOWLEDGE_SURFACE_REPORT_SCHEMA = "KnowledgeSurfaceReport/v1" as const;
export const KNOWLEDGE_SURFACE_PLAN_SCHEMA = "KnowledgeSurfacePlan/v1" as const;
export const SIX_KNOWLEDGE_SURFACES = [
  "explicit-pinned-refs",
  "automatic-knowledge-retrieval",
  "role-memory-retrieval",
  "sekb-experience-retrieval",
  "semantic-source-set-synthesis",
  "post-task-candidate-capture",
] as const;

export type KnowledgeSurfaceStage =
  | "shadow"
  | "opt-in"
  | "canary"
  | "soak"
  | "product-approval"
  | "consider-default-on";

export type KnowledgeEvidenceLevel = "E1" | "E2" | "E3" | "E4" | "E5";

export type KnowledgeCommandKind =
  | "runtime-unit"
  | "runtime-config"
  | "runtime-agents"
  | "root-unit"
  | "e2e";

export type KnowledgeSurfaceCommand = {
  id: string;
  label: string;
  kind: KnowledgeCommandKind;
  files: string[];
};

export type KnowledgeSurfaceDefinition = {
  id: (typeof SIX_KNOWLEDGE_SURFACES)[number];
  title: string;
  currentStage: KnowledgeSurfaceStage;
  stageRationale: string;
  nextPromotionGate: string;
  residual: string[];
  evaluation: { commands: KnowledgeSurfaceCommand[] };
};

export type KnowledgeSurfacePlan = {
  schema: typeof KNOWLEDGE_SURFACE_PLAN_SCHEMA;
  version: 1;
  productLocks: {
    liveReady: false;
    productApproved: false;
    defaultOn: false;
  };
  surfaces: KnowledgeSurfaceDefinition[];
  guardCommands: KnowledgeSurfaceCommand[];
};

export type KnowledgeCommandResult = {
  commandId: string;
  label: string;
  kind: KnowledgeCommandKind;
  exitCode: number;
  testFilesPassed: number;
  testsPassed: number;
  testsFailed: number;
  durationMs: number;
  outputSummary: string;
};

export type KnowledgeSurfaceMetric = {
  commandId: string;
  label: string;
  kind: KnowledgeCommandKind;
  testsPassed: number;
  testsFailed: number;
  testFilesPassed: number;
  exitCode: number;
  durationMs: number;
  outputSummary?: string;
};

export type KnowledgeSurfaceReport = {
  schema: typeof KNOWLEDGE_SURFACE_REPORT_SCHEMA;
  surfaceId: (typeof SIX_KNOWLEDGE_SURFACES)[number];
  title: string;
  currentStage: KnowledgeSurfaceStage;
  stageRationale: string;
  evidenceLevel: KnowledgeEvidenceLevel;
  e4: "not-evaluated";
  e5: "blocked";
  metrics: KnowledgeSurfaceMetric[];
  nextPromotionGate: string;
  residual: string[];
  claims: {
    liveReady: false;
    productApproved: false;
    defaultOn: false;
    ga: false;
  };
  generatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path}: expected non-empty string`);
  }
  return value;
}

function assertCommand(value: unknown, path: string): KnowledgeSurfaceCommand {
  if (!isRecord(value)) throw new Error(`${path}: expected object`);
  return {
    id: assertString(value.id, `${path}.id`),
    label: assertString(value.label, `${path}.label`),
    kind: assertString(value.kind, `${path}.kind`) as KnowledgeCommandKind,
    files: Array.isArray(value.files)
      ? (value.files as unknown[]).map((entry, index) => assertString(entry, `${path}.files[${index}]`))
      : [],
  };
}

function assertSurface(value: unknown, path: string): KnowledgeSurfaceDefinition {
  if (!isRecord(value)) throw new Error(`${path}: expected object`);
  const id = assertString(value.id, `${path}.id`);
  if (!(SIX_KNOWLEDGE_SURFACES as readonly string[]).includes(id)) {
    throw new Error(`${path}.id: unknown surface ${id}`);
  }
  const evaluation = value.evaluation;
  if (!isRecord(evaluation) || !Array.isArray(evaluation.commands) || evaluation.commands.length === 0) {
    throw new Error(`${path}.evaluation.commands: expected non-empty array`);
  }
  return {
    id: id as KnowledgeSurfaceDefinition["id"],
    title: assertString(value.title, `${path}.title`),
    currentStage: assertString(value.currentStage, `${path}.currentStage`) as KnowledgeSurfaceStage,
    stageRationale: assertString(value.stageRationale, `${path}.stageRationale`),
    nextPromotionGate: assertString(value.nextPromotionGate, `${path}.nextPromotionGate`),
    residual: Array.isArray(value.residual)
      ? (value.residual as unknown[]).map((entry, index) => assertString(entry, `${path}.residual[${index}]`))
      : [],
    evaluation: {
      commands: (evaluation.commands as unknown[]).map((entry, index) =>
        assertCommand(entry, `${path}.evaluation.commands[${index}]`),
      ),
    },
  };
}

export function loadKnowledgeSurfacePlan(filePath: string): KnowledgeSurfacePlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`failed to load surface plan ${filePath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!isRecord(parsed)) throw new Error(`${filePath}: expected object`);
  if (parsed.schema !== KNOWLEDGE_SURFACE_PLAN_SCHEMA) throw new Error(`${filePath}: unexpected schema`);
  if (parsed.version !== 1) throw new Error(`${filePath}: expected version 1`);
  const locks = parsed.productLocks;
  if (
    !isRecord(locks) ||
    locks.liveReady !== false ||
    locks.productApproved !== false ||
    locks.defaultOn !== false
  ) {
    throw new Error(`${filePath}: product locks must all be false`);
  }
  const surfaces = Array.isArray(parsed.surfaces)
    ? (parsed.surfaces as unknown[]).map((entry, index) => assertSurface(entry, `${filePath}.surfaces[${index}]`))
    : [];
  if (surfaces.length !== SIX_KNOWLEDGE_SURFACES.length) {
    throw new Error(`${filePath}: expected exactly six surface definitions`);
  }
  const guardCommands = Array.isArray(parsed.guardCommands)
    ? (parsed.guardCommands as unknown[]).map((entry, index) => assertCommand(entry, `${filePath}.guardCommands[${index}]`))
    : [];
  return {
    schema: KNOWLEDGE_SURFACE_PLAN_SCHEMA,
    version: 1,
    productLocks: {
      liveReady: false,
      productApproved: false,
      defaultOn: false,
    },
    surfaces,
    guardCommands,
  };
}

function maxEvidenceLevel(
  hasUnit: boolean,
  hasIntegration: boolean,
  hasE2e: boolean,
): KnowledgeEvidenceLevel {
  if (hasE2e) return "E3";
  if (hasIntegration) return "E2";
  if (hasUnit) return "E1";
  return "E1";
}

export function buildSurfaceReport(params: {
  plan: KnowledgeSurfacePlan;
  surface: KnowledgeSurfaceDefinition;
  results: Record<string, KnowledgeCommandResult>;
  productLocks: KnowledgeSurfacePlan["productLocks"];
  includeE2e: boolean;
  generatedAt: string;
}): KnowledgeSurfaceReport {
  const metrics: KnowledgeSurfaceMetric[] = [];
  let hasUnit = false;
  let hasIntegration = false;
  let hasE2e = false;

  for (const command of params.surface.evaluation.commands) {
    if (command.kind === "e2e" && !params.includeE2e) continue;
    const result = params.results[command.id];
    if (!result) continue;
    if (command.kind === "e2e") hasE2e = result.exitCode === 0;
    if (command.kind === "root-unit") hasUnit = hasUnit || result.exitCode === 0;
    if (
      command.kind === "runtime-unit" ||
      command.kind === "runtime-config" ||
      command.kind === "runtime-agents"
    ) {
      hasUnit = hasUnit || result.exitCode === 0;
      hasIntegration = hasIntegration || result.exitCode === 0;
    }
    metrics.push({
      commandId: result.commandId,
      label: result.label,
      kind: result.kind,
      testsPassed: result.testsPassed,
      testsFailed: result.testsFailed,
      testFilesPassed: result.testFilesPassed,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      ...(result.outputSummary ? { outputSummary: result.outputSummary } : {}),
    });
  }

  return {
    schema: KNOWLEDGE_SURFACE_REPORT_SCHEMA,
    surfaceId: params.surface.id,
    title: params.surface.title,
    currentStage: params.surface.currentStage,
    stageRationale: params.surface.stageRationale,
    evidenceLevel: maxEvidenceLevel(hasUnit, hasIntegration, hasE2e),
    e4: "not-evaluated",
    e5: "blocked",
    metrics,
    nextPromotionGate: params.surface.nextPromotionGate,
    residual: params.surface.residual,
    claims: {
      liveReady: false,
      productApproved: false,
      defaultOn: false,
      ga: false,
    },
    generatedAt: params.generatedAt,
  };
}

export function assertNoFalseGraduation(
  report: KnowledgeSurfaceReport,
  productLocks: KnowledgeSurfacePlan["productLocks"],
): void {
  if (productLocks.liveReady !== false) throw new Error("product lock liveReady must stay false");
  if (productLocks.productApproved !== false) throw new Error("product lock productApproved must stay false");
  if (productLocks.defaultOn !== false) throw new Error("product lock defaultOn must stay false");
  if (report.claims.liveReady) throw new Error("report claims liveReady=true");
  if (report.claims.productApproved) throw new Error("report claims productApproved=true");
  if (report.claims.defaultOn) throw new Error("report claims defaultOn=true");
  if (report.claims.ga) throw new Error("report claims GA");
  if (report.currentStage === "consider-default-on") {
    throw new Error("report claims consider-default-on while product locks are false");
  }
  if (report.evidenceLevel === "E4" || report.evidenceLevel === "E5") {
    throw new Error(`report claims ${report.evidenceLevel} without real E4/E5 evidence`);
  }
}
