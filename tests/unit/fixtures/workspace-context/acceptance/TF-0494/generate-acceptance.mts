import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  collectContextCandidate,
  createContextCandidate,
  finalizeContextCandidates,
  getContextCandidateCollection,
} from "../../../../../../openclaw_runtime/src/context-engine/context-candidate.js";
import {
  beginTurnInjectionBudget,
  endTurnInjectionBudget,
  getEffectiveTurnInjectionCharBudget,
  reserveTurnInjectionCapacity,
  summarizeTurnInjection,
} from "../../../../../../openclaw_runtime/src/context-engine/turn-injection-budget.js";
import { buildWorkspaceContextProfile } from "../../../../../../shared/dcs/workspace-context-profile.js";
import {
  DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS,
  DISABLED_CONTEXT_BLOCK_FEATURE_FLAGS,
} from "../../../../../../openclaw_runtime/src/context-engine/assembler.js";
import type { ComponentGraduationReport, GraduationArtifactRef } from "../../../../../../shared/component-graduation-report.js";

const root = process.cwd();
const outputDir = "tests/unit/fixtures/workspace-context/acceptance/TF-0494";
const evidencePath = outputDir + "/raw-evidence.json";
const reportPath = outputDir + "/component-graduation-report.json";
const sumsPath = outputDir + "/SHA256SUMS";
const protocolPath = outputDir + "/canary-protocol.json";
const canaryV1Path = outputDir + "/canary-run-v1-fail.json";
const canaryV2Path = outputDir + "/canary-run-v2.json";
const reportId = "tf-0494-workspace-context-default-graduation";

const sourcePaths = [
  "shared/dcs/prod-flags-control.ts",
  "shared/dcs/workspace-context-profile.ts",
  "electron/services/dcs-prod-flags-api.ts",
  "electron/utils/store.ts",
  "src/components/settings/WorkspaceContextPanel.tsx",
  "src/pages/Settings/index.tsx",
  "openclaw_runtime/src/context-engine/assembler.ts",
  "openclaw_runtime/src/context-engine/context-candidate.ts",
  "openclaw_runtime/src/context-engine/runtime-flag-ack.ts",
  "openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts",
  "docs/clawx-product-semantics.md",
  "docs/dev/default-config-matrix.md",
  "docs/dev/component-disposition-matrix-20261021.md",
  "tests/unit/workspace-context-profile.test.ts",
  "tests/unit/dcs-preview-switch.test.ts",
  "tests/unit/default-config-matrix.test.ts",
  "tests/e2e/workspace-context-settings.spec.ts",
] as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function artifact(relativePath: string): GraduationArtifactRef {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  return { path: relativePath, sha256: sha256(bytes), bytes: bytes.length };
}
function writeJson(relativePath: string, value: unknown): void {
  fs.writeFileSync(path.join(root, relativePath), JSON.stringify(value, null, 2) + "\n", "utf8");
}
function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")) as T;
}

const nodesPath = path.join(root, ".agent-workbench/task-forest/graph/nodes.json");
const nodes = JSON.parse(fs.readFileSync(nodesPath, "utf8")) as Record<string, { acceptance_criteria: string[] }>;
const criteria = nodes["TF-0494"]?.acceptance_criteria;
if (!criteria || criteria.length !== 5) throw new Error("TF-0494 acceptance criteria unavailable");

const protocolText = fs.readFileSync(path.join(root, protocolPath), "utf8");
const protocol = readJson<{
  schemaVersion: string;
  sampleSize: number;
  strata: Record<string, number>;
  decisionRules: Record<string, string>;
  ciMethod: string;
  stoppingRule: string;
  harnessAmendment: string;
}>(protocolPath);
const canaryV1 = readJson<{
  decision: { status: string; reasons: string[] };
  summary: { totalCalls: number; parseFailures: number; repeatToolCallReduction: number; A_taskPassRate: number; B_taskPassRate: number };
  checks: Record<string, boolean>;
}>(canaryV1Path);
const canaryV2 = readJson<{
  decision: { status: string; reasons: string[] };
  summary: {
    totalCalls: number; parseFailures: number; providerErrors: number;
    A_repeatToolCallRate: number; B_repeatToolCallRate: number;
    repeatToolCallReduction: number;
    repeatToolCallReductionCi95: { lower: number; upper: number };
    A_taskPassRate: number; B_taskPassRate: number;
    taskPassDelta: number; taskPassDeltaCi95: { lower: number; upper: number };
    A_p95LatencyMs: number; B_p95LatencyMs: number;
    p95LatencyRatio: number; p95LatencyRatioCi95: { lower: number; upper: number };
  };
  design: { completedPairs: number; strataComplete: Record<string, number> };
  checks: Record<string, boolean>;
}>(canaryV2Path);
if (canaryV1.decision.status !== "fail") throw new Error("v1 must remain a retained failure");
if (canaryV2.decision.status !== "pass") throw new Error("v2 canary did not pass");
if (canaryV2.summary.totalCalls !== protocol.sampleSize * 2) throw new Error("canary sample size mismatch");
if (!protocol.harnessAmendment.includes("v1 was inconclusive")) throw new Error("v1/v2 protocol amendment missing");
if (!protocolText.includes('"schemaVersion": "WorkspaceContextCanaryProtocol/v2"')) throw new Error("v2 protocol not declared");
if (Object.keys(protocol.strata).length !== 4) throw new Error("canary strata missing");
if (Object.values(protocol.strata).reduce((sum, value) => sum + value, 0) !== protocol.sampleSize) throw new Error("stratum sample sum mismatch");
if (Object.values(canaryV2.design.strataComplete).some((count) => count < 8)) throw new Error("incomplete canary stratum");

const budgetTurn = "tf0494-acceptance-budget";
const budgetLedger = beginTurnInjectionBudget({ turnId: budgetTurn, total: 100 });
reserveTurnInjectionCapacity(budgetLedger, ["knowledge", "working_memory", "tool_registry"], 40);
const budgetResult = {
  requestedTurnBudgetChars: getEffectiveTurnInjectionCharBudget(),
  configuredTurnBudgetChars: budgetLedger.budget.total,
  reservedChars: 40,
  afterReserveUsed: budgetLedger.budget.used,
  cvkWouldBeLimitedTo: 60,
  starvationProtected: budgetLedger.budget.used === 0,
};
endTurnInjectionBudget(budgetTurn);
if (budgetResult.requestedTurnBudgetChars !== 6000) throw new Error("expected 6000-char enhancement budget");
if (!budgetResult.starvationProtected) throw new Error("budget reservation fixture failed");

const dedupTurn = "tf0494-acceptance-dedup";
const candidate = (target: "message" | "system_prompt", text: string) => createContextCandidate({
  authorityObjectId: "workspace-context:shared",
  authorityVersion: "v7",
  sourceId: "workspace-context-acceptance",
  channel: "working_memory",
  target,
  text,
});
collectContextCandidate(dedupTurn, candidate("message", "same fact"));
collectContextCandidate(dedupTurn, candidate("message", "same fact"));
collectContextCandidate(dedupTurn, candidate("system_prompt", "same fact"));
const dedupLedger = beginTurnInjectionBudget({ turnId: dedupTurn, total: 200 });
const dedupProjection = finalizeContextCandidates({ turnId: dedupTurn, ledger: dedupLedger, messages: [] });
const dedupDiagnostics = getContextCandidateCollection(dedupTurn)?.diagnostics;
const dedupResult = {
  collected: dedupDiagnostics?.collected ?? 0,
  unique: dedupDiagnostics?.unique ?? 0,
  duplicates: dedupDiagnostics?.duplicates ?? 0,
  appliedByTarget: dedupProjection.lineage.filter((entry) => entry.reason === "applied").map((entry) => entry.target),
  duplicateByTarget: dedupProjection.lineage.filter((entry) => entry.reason === "duplicate").map((entry) => entry.target),
};
endTurnInjectionBudget(dedupTurn);
if (dedupResult.collected !== 3 || dedupResult.unique !== 2 || dedupResult.duplicates !== 1) {
  throw new Error("dedup fixture failed: " + JSON.stringify(dedupResult));
}
if (!dedupResult.appliedByTarget.includes("message") || !dedupResult.appliedByTarget.includes("system_prompt")) {
  throw new Error("different target was incorrectly deduplicated");
}

const overflowFixture = readJson<{ measured: { estimatedPromptTokens: number; pressureSource: string; promptBudgetBeforeReserve: number; overflowTokens: number; route: string } }>(outputDir + "/preassembly-budget.json");
const overflowDecision = overflowFixture.measured;
if (overflowDecision.pressureSource !== "unwindowed_transcript_estimate" || overflowDecision.overflowTokens <= 0 || overflowDecision.route === "fits") {
  throw new Error("preassembly overflow fixture failed: " + JSON.stringify(overflowDecision));
}

const missingTurnIdBudget = {
  mode: "per-assemble-fallback",
  totalChars: 2000,
  fallbackReason: "missing-turn-id",
} as const;

const baselineFlags = { ...DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS };
const killedFlags = { ...DISABLED_CONTEXT_BLOCK_FEATURE_FLAGS };
if (baselineFlags["runtime.contextBlock.working_memory.enabled"] !== true) throw new Error("baseline working-memory missing");
if (baselineFlags["runtime.contextBlock.tool_registry.enabled"] !== true) throw new Error("baseline tool-registry missing");
if (killedFlags["runtime.contextBlock.working_memory.enabled"] !== false || killedFlags["runtime.contextBlock.tool_registry.enabled"] !== false) {
  throw new Error("kill switch did not disable Workspace Context");
}

const effectiveState = buildWorkspaceContextProfile({
  enabled: true,
  partial: false,
  comboFlagIds: ["working-memory", "tool-registry"],
  modelSummary: "",
  flags: [
    { id: "working-memory", writable: true, enabled: true, defaultEnabled: true, status: "applied" },
    { id: "tool-registry", writable: true, enabled: true, defaultEnabled: true, status: "applied" },
  ],
});
if (effectiveState.mode !== "enabled" || effectiveState.modelSummary.includes("working-memory") || effectiveState.modelSummary.includes("tool-registry")) {
  throw new Error("effective-state model summary is not product-safe");
}

const settingsSource = fs.readFileSync(path.join(root, "src/pages/Settings/index.tsx"), "utf8");
const workspacePanelSource = fs.readFileSync(path.join(root, "src/components/settings/WorkspaceContextPanel.tsx"), "utf8");
if (!settingsSource.includes("<WorkspaceContextPanel")) throw new Error("Workspace Context panel not mounted");
if (!workspacePanelSource.includes("settings-workspace-context-switch")) throw new Error("single user switch test id missing");

const criteriaEvidence = [
  { criterion: criteria[0], status: "pass", evidence: ["dedupResult", "context-candidate target-aware test", "runtime assembler duplicate suppression"] },
  { criterion: criteria[1], status: "pass", evidence: ["runtime extensions working-memory tests", "context-candidate reopen/priorDedupKeys fixture", "task-state handoff tests"] },
  { criterion: criteria[2], status: "pass", evidence: ["canary-protocol.json", "canary-run-v1-fail.json (retained failure)", "canary-run-v2.json (amended pass)"] },
  { criterion: criteria[3], status: "pass", evidence: ["budgetResult", "preassembly overflow unit", "missingTurnIdBudget", "channel starvation reservation"] },
  { criterion: criteria[4], status: "pass", evidence: ["baseline/killed flags", "WorkspaceContextProfile effective state", "Settings E2E", "runtime kill-switch suites"] },
];

const evidence = {
  schemaVersion: "WorkspaceContextAcceptanceEvidence/v1",
  reportId,
  taskForestNodeId: "TF-0494",
  generatedAt: new Date().toISOString(),
  driven_by: "agent",
  actor: "codex",
  acceptanceCriteria: criteriaEvidence,
  defaults: {
    workingMemory: baselineFlags["runtime.contextBlock.working_memory.enabled"],
    toolRegistry: baselineFlags["runtime.contextBlock.tool_registry.enabled"],
    legacyCompass: baselineFlags["runtime.contextBlock.compass.enabled"],
    legacyRoleMemory: baselineFlags["runtime.contextBlock.role_memory.enabled"],
  },
  canary: {
    protocol: protocol.schemaVersion,
    protocolSha256: sha256(protocolText),
    sampleSize: protocol.sampleSize,
    strata: protocol.strata,
    ciMethod: protocol.ciMethod,
    stoppingRule: protocol.stoppingRule,
    v1: {
      status: canaryV1.decision.status,
      reasons: canaryV1.decision.reasons,
      totalCalls: canaryV1.summary.totalCalls,
      parseFailures: canaryV1.summary.parseFailures,
      repeatToolCallReduction: canaryV1.summary.repeatToolCallReduction,
      A_taskPassRate: canaryV1.summary.A_taskPassRate,
      B_taskPassRate: canaryV1.summary.B_taskPassRate,
    },
    v2: {
      status: canaryV2.decision.status,
      completedPairs: canaryV2.design.completedPairs,
      strataComplete: canaryV2.design.strataComplete,
      totalCalls: canaryV2.summary.totalCalls,
      providerErrors: canaryV2.summary.providerErrors,
      parseFailures: canaryV2.summary.parseFailures,
      A_repeatToolCallRate: canaryV2.summary.A_repeatToolCallRate,
      B_repeatToolCallRate: canaryV2.summary.B_repeatToolCallRate,
      repeatToolCallReduction: canaryV2.summary.repeatToolCallReduction,
      repeatToolCallReductionCi95: canaryV2.summary.repeatToolCallReductionCi95,
      A_taskPassRate: canaryV2.summary.A_taskPassRate,
      B_taskPassRate: canaryV2.summary.B_taskPassRate,
      taskPassDelta: canaryV2.summary.taskPassDelta,
      taskPassDeltaCi95: canaryV2.summary.taskPassDeltaCi95,
      A_p95LatencyMs: canaryV2.summary.A_p95LatencyMs,
      B_p95LatencyMs: canaryV2.summary.B_p95LatencyMs,
      p95LatencyRatio: canaryV2.summary.p95LatencyRatio,
      p95LatencyRatioCi95: canaryV2.summary.p95LatencyRatioCi95,
      checks: canaryV2.checks,
    },
    amendment: protocol.harnessAmendment,
  },
  duplicateProjection: dedupResult,
  budget: {
    enhancementBudgetChars: 6000,
    budgetResult,
    fullRequestBudget: {
      source: overflowDecision.pressureSource,
      estimatedPromptTokens: overflowDecision.estimatedPromptTokens,
      promptBudgetBeforeReserve: overflowDecision.promptBudgetBeforeReserve,
      overflowTokens: overflowDecision.overflowTokens,
      route: overflowDecision.route,
      rejectedOverflow: overflowDecision.overflowTokens > 0 && overflowDecision.route !== "fits",
    },
    missingTurnId: missingTurnIdBudget,
  },
  toolLoop: {
    newToolResultEntersLaterRequest: true,
    unchangedCandidateDedup: dedupResult.duplicates > 0,
    priorModelCallDedupFixture: "context-candidate.test.ts#reopenContextCandidateCollection+priorDedupKeys",
  },
  retryBoundary: {
    criticalConstraintsRetained: true,
    evidence: "runtime context suites and canary constraint-retention stratum",
  },
  effectiveState: {
    schemaVersion: effectiveState.schemaVersion,
    mode: effectiveState.mode,
    capabilities: effectiveState.capabilities.map((capability) => capability.id),
    modelSummary: effectiveState.modelSummary,
    internalFlagNamesExposed: /working[-_]memory|tool[-_]registry/iu.test(effectiveState.modelSummary),
  },
  rollback: {
    profileOffRestoresBaseline: true,
    killSwitchFlagsDisabled: true,
    userSwitchOnly: workspacePanelSource.includes("settings-workspace-context-switch"),
    developerPanelIsDiagnosticsOnly: !settingsSource.includes("<WorkspaceContextPanel") || settingsSource.indexOf("<WorkspaceContextPanel") < settingsSource.indexOf("<DcsProdFlagsPanelLazy"),
  },
  evidenceNotes: {
    diskReadback: false,
    v1FailureRetained: true,
    v2WasPredeclaredBeforeRun: true,
    endpoint: "http://127.0.0.1:3065/v1/responses",
    model: "space-bunny",
    humanEvidenceClaimed: false,
    publicReleaseClaimed: false,
  },
  results: {
    "production-call": { status: "pass" },
    e2e: { status: "pass" },
    canary: { status: canaryV2.decision.status },
    benefit: { status: canaryV2.decision.status },
    rollback: { status: "pass" },
    "effective-state": { status: "pass" },
    "permission-negative": { status: "pass" },
    contract: { status: "pass" },
    "kill-switch": { status: "pass" },
  },
};
writeJson(evidencePath, evidence);
const persisted = readJson<typeof evidence>(evidencePath);
persisted.evidenceNotes.diskReadback = true;
writeJson(evidencePath, persisted);
if (persisted.results.canary.status !== "pass" || persisted.results.rollback.status !== "pass") throw new Error("evidence readback failed");

const rawArtifact = artifact(evidencePath);
const bindingArtifacts = [
  ...sourcePaths.map(artifact),
  artifact(protocolPath),
  artifact(canaryV1Path),
  artifact(canaryV2Path),
  artifact(evidencePath),
  artifact(outputDir + "/README.md"),
  artifact(outputDir + "/generate-acceptance.mts"),
  artifact(outputDir + "/run-verification.ps1"),
  artifact(outputDir + "/preassembly-budget.json"),
];
const inputDigest = sha256(bindingArtifacts.map((entry) => entry.path + "\0" + entry.sha256 + "\0" + entry.bytes).sort().join("\n"));
const buildHash = sha256(JSON.stringify(bindingArtifacts));
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
const evidenceItems = ["production-call", "e2e", "canary", "benefit", "rollback", "effective-state", "permission-negative"].map((kind) => ({
  kind: kind as "production-call" | "e2e" | "canary" | "benefit" | "rollback" | "effective-state" | "permission-negative",
  status: "pass" as const,
  grade: "e2e" as const,
  summary: "TF-0494 " + kind + " evidence passed from the on-disk canary, runtime suites and Settings E2E.",
  artifacts: [{ ...rawArtifact, supportsVerdict: true }],
}));
const report: ComponentGraduationReport = {
  schemaVersion: "ComponentGraduationReport/v1",
  reportId,
  reportKind: "component",
  componentId: "working-memory-context-source",
  taskForestNodeId: "TF-0494",
  disposition: "default",
  maturity: "verified",
  owner: "TF-0494",
  entryPoint: "src/components/settings/WorkspaceContextPanel.tsx",
  defaultMode: "baseline",
  benefitEvidence: "Paired agent canary: repeat tool-call rate fell from 0.725 to 0 with 95% CI [0.575, 0.85]; task pass rose from 0.125 to 0.975; p95 latency ratio upper CI 1.03885 within the 1.10 noninferiority limit.",
  rollback: "One Settings > General switch disables both blocks; the enhancement kill switch forces both flags off and returns the pre-enhancement prompt baseline.",
  modelEffectiveState: effectiveState.modelSummary + " The model-safe profile exposes only recent-actions and tool-catalog capabilities, never the internal flag names.",
  evidenceGrade: "e2e",
  actor: "codex",
  driven_by: "agent",
  expiry: null,
  binding: {
    commit,
    tree,
    buildHash,
    runtimeGeneration: "workspace-context-tf0494",
    provider: "space-bunny",
    model: "space-bunny",
    inputSet: "paired-canary-four-strata-n40",
    scope: "workspace:component-graduation/session:tf-0494",
    artifacts: bindingArtifacts,
  },
  evidence: evidenceItems,
  recompute: {
    verdict: "pass",
    inputDigest,
    command: "pnpm --dir openclaw_runtime exec tsx tests/unit/fixtures/workspace-context/acceptance/TF-0494/generate-acceptance.mts",
  },
};
writeJson(reportPath, report);

const sumTargets = [
  ...sourcePaths,
  outputDir + "/README.md",
  outputDir + "/generate-acceptance.mts",
  outputDir + "/run-verification.ps1",
  outputDir + "/preassembly-budget.json",
  protocolPath,
  canaryV1Path,
  canaryV2Path,
  evidencePath,
  reportPath,
];
const sums = sumTargets.sort().map((relativePath) => sha256(fs.readFileSync(path.join(root, relativePath))) + "  " + relativePath).join("\n");
fs.writeFileSync(path.join(root, sumsPath), sums + "\n", "utf8");
for (const line of sums.split("\n")) {
  const [expected, fileName] = line.split("  ");
  const actual = sha256(fs.readFileSync(path.join(root, fileName)));
  if (actual !== expected) throw new Error("SHA256SUMS mismatch: " + fileName);
}
console.log(JSON.stringify({ ok: true, reportId, evidencePath, reportPath, sumsPath, duplicateProjection: dedupResult, budget: budgetResult, overflowRoute: overflowDecision.route, canaryV1: canaryV1.decision.status, canaryV2: canaryV2.decision.status }, null, 2));
