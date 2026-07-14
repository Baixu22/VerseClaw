import type { RoleContract } from "./role-contract.js";

export type OrchestrationDifficulty = "simple" | "moderate" | "complex" | "high_risk";
export type OrchestrationQualityPolicy = "standard" | "strict";
export type WorkerCommunicationPolicy = "none" | "lead_mediated" | "bounded_a2a";
export type OrchestrationGraphMode = "auto" | "flat" | "staged";
export type OrchestrationGraphStatus = "planned" | "running" | "partial" | "failed" | "completed";
export type OrchestrationTaskNodePhase =
  | "plan"
  | "architecture"
  | "worker"
  | "implementation"
  | "verification"
  | "review"
  | "security"
  | "docs"
  | "verifier"
  | "repair"
  | "redo"
  | "followup";
export type OrchestrationTaskEdgeType = "dependency" | "handoff" | "verification" | "repair_of" | "followup_of";

export type OrchestrationRepairPolicy = {
  maxRepairAttempts: number;
  maxRedoAttempts: number;
  maxFollowupRuns: number;
};

export type RouteDiagnostics = {
  difficulty: OrchestrationDifficulty;
  confidence: number;
  reasons: string[];
  selectedRoles: string[];
  rejectedRoles: Array<{ roleName: string; reason: string }>;
  requiredCapabilities: string[];
  capabilityGaps: Array<{ roleName: string; missing: string[] }>;
};

export type OrchestrationTaskLedgerEntry = {
  taskId: string;
  taskNodeId?: string;
  graphRunId?: string;
  roleName: string;
  roleInstanceId: string;
  attempt: number;
  phase: "worker" | "verifier";
  scope: string;
  requiredCapabilities: string[];
  status: "planned" | "accepted" | "failed";
  dependsOn?: string[];
  repairOf?: string;
  followupOf?: string;
  executionWave?: number;
  startedAt?: number;
  endedAt?: number;
};

export type OrchestrationTaskNode = {
  taskNodeId: string;
  agentId?: string;
  roleName: string;
  task: string;
  phase: OrchestrationTaskNodePhase;
  dependsOn: string[];
  scope: string;
  requiredCapabilities: string[];
  attemptPolicy: Pick<OrchestrationRepairPolicy, "maxRepairAttempts" | "maxRedoAttempts">;
  status: "planned" | "ready" | "running" | "accepted" | "failed" | "skipped";
  modelRef?: string | null;
  isVerifier?: boolean;
  repairOf?: string;
  followupOf?: string;
};

export type OrchestrationTaskEdge = {
  from: string;
  to: string;
  type: OrchestrationTaskEdgeType;
};

export type OrchestrationExecutionWave = {
  wave: number;
  taskNodeIds: string[];
  roles: string[];
};

export type OrchestrationTaskGraph = {
  graphRunId: string;
  mode: OrchestrationGraphMode;
  status: OrchestrationGraphStatus;
  nodes: OrchestrationTaskNode[];
  edges: OrchestrationTaskEdge[];
};

export type OrchestrationRepairNode = OrchestrationTaskNode & {
  repairAction: "repair" | "redo";
  reason: string;
};

export type OrchestrationRerouteRecommendation = {
  sourceTaskNodeId?: string;
  roleName: string;
  reason: string;
  missingCapabilities?: string[];
};

export type OrchestrationDiagnosticsRecommendation = {
  code: "worker-spawn-failed" | "reroute-consideration";
  roleName?: string;
  message: string;
  recommendedAction: string;
};

export type OrchestrationDiagnostics = {
  kind: "ordinary-orchestration-diagnostics";
  boundary: "diagnostics-only";
  status: "ok" | "needs_attention";
  summary: string;
  failedWorkerCount: number;
  taskLoopUpgradeAvailable: boolean;
  recommendations: OrchestrationDiagnosticsRecommendation[];
  nextSteps: string[];
};

export type OrchestratorGraphWorker = {
  roleName: string;
  task: string;
  agentId?: string;
  modelRef?: string | null;
};

export type WorkerQualityScore = {
  roleName: string;
  childRunId: string;
  childSessionKey?: string;
  overall: "good" | "needs_attention" | "poor_attempt";
  score: number;
  schemaCompliance: "pass" | "weak" | "fail";
  evidenceCoverage: "strong" | "partial" | "missing";
  scopeDiscipline: "pass" | "risk" | "fail";
  actionability: "strong" | "partial" | "missing";
  verificationSignal: "present" | "weak" | "missing";
  verifierVerdict: "accepted" | "partial" | "refuted" | "not_available";
  runtimeHealth: "healthy" | "tool_error" | "timeout" | "empty_output" | "error";
  reasons: string[];
};

export type FollowupCandidate = {
  roleName: string;
  childRunId: string;
  task: string;
  reason: string;
};

export type OrchestrationMemoryCandidate = {
  content: string;
  scopeKey: string;
  roleName: string;
  evidenceRefs: string[];
  importance: "low" | "medium" | "high";
  durability: "session" | "project" | "long_term";
  sensitivity?: string;
};

const DEFAULT_REPAIR_POLICY: OrchestrationRepairPolicy = {
  maxRepairAttempts: 1,
  maxRedoAttempts: 1,
  maxFollowupRuns: 2,
};

function cleanList(values: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.flatMap((value) => {
    if (typeof value !== "string") {
      return [];
    }
    const text = value.trim();
    return text ? [text] : [];
  });
}

export function normalizeQualityPolicy(value: unknown): OrchestrationQualityPolicy {
  return value === "strict" ? "strict" : "standard";
}

export function normalizeGraphMode(value: unknown): OrchestrationGraphMode {
  return value === "flat" || value === "staged" ? value : "auto";
}

export function normalizeWorkerCommunication(value: unknown): WorkerCommunicationPolicy {
  return value === "lead_mediated" || value === "bounded_a2a" ? value : "none";
}

export function normalizeRepairPolicy(value: unknown): OrchestrationRepairPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_REPAIR_POLICY };
  }
  const record = value as Record<string, unknown>;
  const positive = (next: unknown, fallback: number): number =>
    typeof next === "number" && Number.isFinite(next) && next >= 0
      ? Math.floor(next)
      : fallback;
  return {
    maxRepairAttempts: positive(record.maxRepairAttempts, DEFAULT_REPAIR_POLICY.maxRepairAttempts),
    maxRedoAttempts: positive(record.maxRedoAttempts, DEFAULT_REPAIR_POLICY.maxRedoAttempts),
    maxFollowupRuns: positive(record.maxFollowupRuns, DEFAULT_REPAIR_POLICY.maxFollowupRuns),
  };
}

export function inferRequiredCapabilities(params: {
  task: string;
  fileHints?: readonly string[];
  important?: boolean;
}): string[] {
  const task = params.task.toLowerCase();
  const files = params.fileHints ?? [];
  const capabilities = new Set<string>(["task-analysis"]);
  if (/implement|fix|add|update|code|patch|edit|write|实现|修复|新增|修改/.test(task)) {
    capabilities.add("code-change");
  }
  if (/test|verify|coverage|spec|验证|测试/.test(task) || files.some((file) => /test|spec/i.test(file))) {
    capabilities.add("verification");
  }
  if (/doc|readme|guide|说明|文档/.test(task) || files.some((file) => /readme|docs?|\.md$/i.test(file))) {
    capabilities.add("documentation");
  }
  if (
    params.important ||
    /security|auth|secret|credential|permission|安全|权限|密钥/.test(task) ||
    files.some((file) => /auth|token|secret|permission|security/i.test(file))
  ) {
    capabilities.add("security-review");
    capabilities.add("adversarial-review");
  }
  if (/architecture|design|boundary|refactor|架构|设计|重构/.test(task)) {
    capabilities.add("architecture");
  }
  if (files.length >= 3 || /multi-file|module|模块/.test(task)) {
    capabilities.add("multi-file-coordination");
  }
  return [...capabilities];
}

function roleCapabilities(role: RoleContract): string[] {
  return [...new Set([...(role.capabilities ?? []), ...(role.tags ?? []), ...role.tools.map((tool) => `tool:${tool}`)])];
}

function roleCapabilityGap(role: RoleContract, required: readonly string[]): string[] {
  const provided = new Set(roleCapabilities(role));
  return required.filter((capability) => {
    if (capability === "task-analysis") {
      return false;
    }
    if (capability === "code-change") {
      return !provided.has("code-change") && role.permissions.filesystem !== "write" && role.permissions.filesystem !== "admin";
    }
    return !provided.has(capability);
  });
}

function nodeIdForRole(roleName: string, occurrence: number): string {
  return `${roleName.replace(/[^a-zA-Z0-9-]/g, "-")}-${occurrence}`;
}

function phaseForRole(roleName: string): OrchestrationTaskNodePhase {
  switch (roleName) {
    case "planner":
      return "plan";
    case "architect":
      return "architecture";
    case "implementer":
      return "implementation";
    case "tester":
      return "verification";
    case "reviewer":
      return "review";
    case "security-reviewer":
      return "security";
    case "docs-writer":
      return "docs";
    case "skeptic":
      return "verifier";
    default:
      return "worker";
  }
}

function inferDependencies(params: {
  mode: string;
  roleName: string;
  existingNodes: readonly OrchestrationTaskNode[];
}): string[] {
  if (params.mode === "router" || params.mode === "adversarial-review") {
    return [];
  }
  const byRole = (roles: readonly string[]) =>
    params.existingNodes.filter((node) => roles.includes(node.roleName)).map((node) => node.taskNodeId);
  switch (params.roleName) {
    case "implementer":
    case "docs-writer":
      return byRole(["planner", "architect"]);
    case "tester": {
      const implementers = byRole(["implementer"]);
      return implementers.length ? implementers : byRole(["planner", "architect"]);
    }
    case "reviewer": {
      const testers = byRole(["tester"]);
      return testers.length ? testers : byRole(["implementer", "docs-writer"]);
    }
    case "security-reviewer":
      return byRole(["implementer", "architect"]);
    default:
      return [];
  }
}

function buildEdges(nodes: readonly OrchestrationTaskNode[]): OrchestrationTaskEdge[] {
  const edges: OrchestrationTaskEdge[] = [];
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      edges.push({
        from: dep,
        to: node.taskNodeId,
        type: node.phase === "verification" || node.phase === "review" || node.phase === "verifier"
          ? "verification"
          : "dependency",
      });
    }
    if (node.repairOf) {
      edges.push({ from: node.repairOf, to: node.taskNodeId, type: "repair_of" });
    }
    if (node.followupOf) {
      edges.push({ from: node.followupOf, to: node.taskNodeId, type: "followup_of" });
    }
  }
  return edges;
}

export function buildTaskGraph(params: {
  graphRunId: string;
  agentId?: string;
  mode: string;
  graphMode?: OrchestrationGraphMode;
  workers: readonly OrchestratorGraphWorker[];
  verifierRole?: string;
  verifierTask?: string;
  verifierModelRef?: string | null;
  requiredCapabilities: readonly string[];
  repairPolicy?: OrchestrationRepairPolicy;
}): OrchestrationTaskGraph {
  const graphMode = params.graphMode ?? "auto";
  const effectiveMode = graphMode === "auto" && params.mode !== "router" ? "staged" : graphMode;
  const occurrences = new Map<string, number>();
  const nodes: OrchestrationTaskNode[] = [];
  for (const worker of params.workers) {
    const occurrence = (occurrences.get(worker.roleName) ?? 0) + 1;
    occurrences.set(worker.roleName, occurrence);
    const phase = phaseForRole(worker.roleName);
    const dependsOn = effectiveMode === "staged"
      ? inferDependencies({ mode: params.mode, roleName: worker.roleName, existingNodes: nodes })
      : [];
    nodes.push({
      taskNodeId: nodeIdForRole(worker.roleName, occurrence),
      ...(worker.agentId ?? params.agentId ? { agentId: worker.agentId ?? params.agentId } : {}),
      roleName: worker.roleName,
      task: worker.task,
      phase,
      dependsOn,
      scope: worker.task,
      requiredCapabilities: [...params.requiredCapabilities],
      attemptPolicy: {
        maxRepairAttempts: params.repairPolicy?.maxRepairAttempts ?? DEFAULT_REPAIR_POLICY.maxRepairAttempts,
        maxRedoAttempts: params.repairPolicy?.maxRedoAttempts ?? DEFAULT_REPAIR_POLICY.maxRedoAttempts,
      },
      status: dependsOn.length === 0 ? "ready" : "planned",
      ...(worker.modelRef !== undefined ? { modelRef: worker.modelRef } : {}),
    });
  }
  if (params.verifierRole) {
    const occurrence = (occurrences.get(params.verifierRole) ?? 0) + 1;
    const verifierNode: OrchestrationTaskNode = {
      taskNodeId: nodeIdForRole(params.verifierRole, occurrence),
      ...(params.agentId ? { agentId: params.agentId } : {}),
      roleName: params.verifierRole,
      task: params.verifierTask ?? `Verify completion as ${params.verifierRole}`,
      phase: "verifier",
      dependsOn: nodes.filter((node) => !node.isVerifier).map((node) => node.taskNodeId),
      scope: params.verifierTask ?? "Verify worker evidence",
      requiredCapabilities: [...params.requiredCapabilities, "verification"],
      attemptPolicy: {
        maxRepairAttempts: 0,
        maxRedoAttempts: 0,
      },
      status: "planned",
      isVerifier: true,
      ...(params.verifierModelRef !== undefined ? { modelRef: params.verifierModelRef } : {}),
    };
    nodes.push(verifierNode);
  }
  return {
    graphRunId: params.graphRunId,
    mode: graphMode,
    status: "planned",
    nodes,
    edges: buildEdges(nodes),
  };
}

export function buildExecutionWaves(
  graph: OrchestrationTaskGraph,
  maxWorkers?: number,
): OrchestrationExecutionWave[] {
  const remaining = new Map(graph.nodes.map((node) => [node.taskNodeId, node]));
  const completed = new Set<string>();
  const waves: OrchestrationExecutionWave[] = [];
  const workerCap = Math.max(1, Math.floor(maxWorkers ?? Number.MAX_SAFE_INTEGER));
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((node) => node.dependsOn.every((dep) => completed.has(dep)));
    if (ready.length === 0) {
      break;
    }
    for (let index = 0; index < ready.length; index += workerCap) {
      const chunk = ready.slice(index, index + workerCap);
      const wave = waves.length + 1;
      waves.push({
        wave,
        taskNodeIds: chunk.map((node) => node.taskNodeId),
        roles: chunk.map((node) => node.roleName),
      });
      for (const node of chunk) {
        remaining.delete(node.taskNodeId);
        completed.add(node.taskNodeId);
      }
    }
  }
  return waves;
}

export function taskGraphWorkerNodes(graph: OrchestrationTaskGraph): OrchestrationTaskNode[] {
  return graph.nodes.filter((node) => !node.isVerifier);
}

export function taskGraphVerifierNode(graph: OrchestrationTaskGraph): OrchestrationTaskNode | undefined {
  return graph.nodes.find((node) => node.isVerifier);
}

export function buildRouteDiagnostics(params: {
  task: string;
  fileHints?: readonly string[];
  important?: boolean;
  mode: string;
  selectedRoleNames: readonly string[];
  reasons: readonly string[];
  roles: readonly RoleContract[];
  templateId?: string;
}): RouteDiagnostics {
  const requiredCapabilities = inferRequiredCapabilities(params);
  const selectedRoles = [...new Set(params.selectedRoleNames.filter(Boolean))];
  const selectedRoleSet = new Set(selectedRoles);
  const capabilityGaps = params.roles
    .filter((role) => selectedRoleSet.has(role.name))
    .map((role) => ({ roleName: role.name, missing: roleCapabilityGap(role, requiredCapabilities) }))
    .filter((gap) => gap.missing.length > 0);
  const fileCount = params.fileHints?.length ?? 0;
  const highRisk = requiredCapabilities.includes("security-review") || params.mode === "adversarial-review";
  const complex = params.mode !== "router" || fileCount >= 3 || requiredCapabilities.includes("multi-file-coordination");
  const difficulty: OrchestrationDifficulty = highRisk
    ? "high_risk"
    : complex
      ? "complex"
      : requiredCapabilities.length > 2
        ? "moderate"
        : "simple";
  const confidenceBase = params.templateId ? 0.9 : difficulty === "simple" ? 0.74 : 0.68;
  const confidence = Math.max(0.45, Math.min(0.95, confidenceBase - capabilityGaps.length * 0.08));
  return {
    difficulty,
    confidence,
    reasons: [
      ...params.reasons,
      `difficulty:${difficulty}`,
      `confidence:${confidence.toFixed(2)}`,
      ...(capabilityGaps.length > 0 ? ["capability-gaps"] : []),
    ],
    selectedRoles,
    rejectedRoles: params.roles
      .filter((role) => !selectedRoleSet.has(role.name))
      .map((role) => ({
        roleName: role.name,
        reason: roleCapabilityGap(role, requiredCapabilities).length > 0 ? "capability-gap" : "not-selected-by-route",
      })),
    requiredCapabilities,
    capabilityGaps,
  };
}

export function makeTaskLedgerEntry(params: {
  orchestrationRunId: string;
  roleName: string;
  task: string;
  index: number;
  phase: "worker" | "verifier";
  requiredCapabilities: readonly string[];
  taskNodeId?: string;
  graphRunId?: string;
  dependsOn?: readonly string[];
  repairOf?: string;
  followupOf?: string;
  executionWave?: number;
  status?: OrchestrationTaskLedgerEntry["status"];
  startedAt?: number;
  endedAt?: number;
}): OrchestrationTaskLedgerEntry {
  const phasePrefix = params.phase === "verifier" ? "verifier" : "worker";
  const taskId = params.taskNodeId ?? `${phasePrefix}-${params.index + 1}`;
  return {
    taskId,
    ...(params.taskNodeId ? { taskNodeId: params.taskNodeId } : {}),
    ...(params.graphRunId ? { graphRunId: params.graphRunId } : {}),
    roleName: params.roleName,
    roleInstanceId: `${params.orchestrationRunId}:${taskId}:${params.roleName}:attempt-1`,
    attempt: 1,
    phase: params.phase,
    scope: params.task,
    requiredCapabilities: [...params.requiredCapabilities],
    status: params.status ?? "planned",
    ...(params.dependsOn?.length ? { dependsOn: [...params.dependsOn] } : {}),
    ...(params.repairOf ? { repairOf: params.repairOf } : {}),
    ...(params.followupOf ? { followupOf: params.followupOf } : {}),
    ...(typeof params.executionWave === "number" ? { executionWave: params.executionWave } : {}),
    ...(typeof params.startedAt === "number" ? { startedAt: params.startedAt } : {}),
    ...(typeof params.endedAt === "number" ? { endedAt: params.endedAt } : {}),
  };
}

function sectionLines(text: string, title: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^#{0,3}\\s*${title}\\b`, "i").test(line.trim()));
  if (start < 0) {
    return [];
  }
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3}\s+\S/.test(line.trim())) {
      break;
    }
    const trimmed = line.replace(/^[-*]\s*/, "").trim();
    if (!trimmed || /^(none|n\/a|no\b)/i.test(trimmed)) {
      continue;
    }
    body.push(trimmed);
  }
  return body.slice(0, 5);
}

export function extractFollowupCandidates(params: {
  text?: string;
  roleName: string;
  childRunId: string;
}): FollowupCandidate[] {
  return sectionLines(params.text ?? "", "Follow-up Candidates").map((line) => ({
    roleName: params.roleName,
    childRunId: params.childRunId,
    task: line,
    reason: "worker-proposed-followup",
  }));
}

function memoryCandidateField(line: string, key: "content" | "scopeKey"): string | undefined {
  return line.match(new RegExp(`(?:^|;)\\s*${key}\\s*:\\s*([^;]+)`, "iu"))?.[1]?.trim();
}

export function extractMemoryCandidates(params: {
  text?: string;
  roleName: string;
  childRunId: string;
  scopeKey?: string;
}): OrchestrationMemoryCandidate[] {
  return sectionLines(params.text ?? "", "Memory Candidates").map((line) => ({
    content: memoryCandidateField(line, "content") ?? line,
    scopeKey: memoryCandidateField(line, "scopeKey") ?? params.scopeKey ?? params.childRunId,
    roleName: params.roleName,
    evidenceRefs: [params.childRunId],
    importance: /important|critical|must|必须|重要/i.test(line) ? "high" : "medium",
    durability: /long.?term|长期/i.test(line) ? "long_term" : "project",
  }));
}

export function scoreWorkerQuality(params: {
  roleName: string;
  childRunId: string;
  childSessionKey?: string;
  resultText?: string;
  outcomeStatus?: string;
  outcomeError?: string;
  verifierOutcomeStatus?: string;
}): WorkerQualityScore {
  const text = params.resultText?.trim() ?? "";
  const reasons: string[] = [];
  const hasEvidence = /(\b[A-Za-z]:\\|\/[\w.-]+|[\w.-]+\.(ts|tsx|js|jsx|md|json|rs|py)|test|spec|log|evidence|verified|passed|failed)/i.test(text);
  const hasVerification = /(test|verify|verified|passed|failed|coverage|检查|验证|测试)/i.test(text);
  const empty = text.length === 0;
  const runtimeHealth: WorkerQualityScore["runtimeHealth"] =
    params.outcomeStatus === "timeout"
      ? "timeout"
      : params.outcomeStatus && params.outcomeStatus !== "ok"
        ? params.outcomeError?.toLowerCase().includes("tool")
          ? "tool_error"
          : "error"
        : empty
          ? "empty_output"
          : "healthy";
  if (runtimeHealth !== "healthy") {
    reasons.push(`runtime:${runtimeHealth}`);
  }
  const schemaCompliance = empty ? "fail" : /^#{1,3}\s|\n[-*]\s|\n\w+:/m.test(text) ? "pass" : "weak";
  if (schemaCompliance !== "pass") {
    reasons.push(`schema:${schemaCompliance}`);
  }
  const evidenceCoverage = hasEvidence ? "strong" : text.length > 300 ? "partial" : "missing";
  if (evidenceCoverage === "missing") {
    reasons.push("missing-evidence");
  }
  const scopeDiscipline = /sessions_send|spawn(ed)? another|new subagent/i.test(text) ? "risk" : "pass";
  if (scopeDiscipline !== "pass") {
    reasons.push("scope-risk");
  }
  const actionability = empty ? "missing" : text.length >= 120 ? "strong" : "partial";
  if (actionability !== "strong") {
    reasons.push(`actionability:${actionability}`);
  }
  const verificationSignal = hasVerification ? "present" : text.length > 250 ? "weak" : "missing";
  if (verificationSignal === "missing") {
    reasons.push("missing-verification-signal");
  }
  const verifierVerdict: WorkerQualityScore["verifierVerdict"] =
    params.verifierOutcomeStatus === "error"
      ? "refuted"
      : params.verifierOutcomeStatus === "ok"
        ? "accepted"
        : "not_available";
  let score = 100;
  if (runtimeHealth !== "healthy") score -= 40;
  if (schemaCompliance === "weak") score -= 10;
  if (schemaCompliance === "fail") score -= 25;
  if (evidenceCoverage === "partial") score -= 10;
  if (evidenceCoverage === "missing") score -= 20;
  if (scopeDiscipline !== "pass") score -= 20;
  if (actionability === "partial") score -= 10;
  if (actionability === "missing") score -= 25;
  if (verificationSignal === "weak") score -= 5;
  if (verificationSignal === "missing") score -= 10;
  if (verifierVerdict === "refuted") score -= 25;
  const boundedScore = Math.max(0, Math.min(100, score));
  return {
    roleName: params.roleName,
    childRunId: params.childRunId,
    ...(params.childSessionKey ? { childSessionKey: params.childSessionKey } : {}),
    overall: boundedScore <= 50 ? "poor_attempt" : boundedScore < 75 ? "needs_attention" : "good",
    score: boundedScore,
    schemaCompliance,
    evidenceCoverage,
    scopeDiscipline,
    actionability,
    verificationSignal,
    verifierVerdict,
    runtimeHealth,
    reasons,
  };
}

export function recommendRepairAction(params: {
  status?: string;
  error?: string;
  resultText?: string;
  verifierVerdict?: WorkerQualityScore["verifierVerdict"];
}): "none" | "repair" | "redo" | "reroute" {
  const error = params.error?.toLowerCase() ?? "";
  if (params.status === "ok" && params.verifierVerdict !== "refuted") {
    return "none";
  }
  if (error.includes("permission") || error.includes("forbidden")) {
    return "reroute";
  }
  if (params.status === "timeout" || !params.resultText?.trim()) {
    return "redo";
  }
  if (params.verifierVerdict === "refuted") {
    return "repair";
  }
  return "repair";
}

export function buildRepairNodes(params: {
  taskGraph?: OrchestrationTaskGraph;
  attempts: readonly {
    roleName: string;
    taskId?: string;
    childRunId?: string;
    status?: string;
    error?: string;
    resultText?: string;
    verifierVerdict?: WorkerQualityScore["verifierVerdict"];
  }[];
  repairPolicy?: OrchestrationRepairPolicy;
}): OrchestrationRepairNode[] {
  const maxRepair = params.repairPolicy?.maxRepairAttempts ?? DEFAULT_REPAIR_POLICY.maxRepairAttempts;
  const maxRedo = params.repairPolicy?.maxRedoAttempts ?? DEFAULT_REPAIR_POLICY.maxRedoAttempts;
  const nodesById = new Map(params.taskGraph?.nodes.map((node) => [node.taskNodeId, node]) ?? []);
  return params.attempts.flatMap((attempt, index) => {
    const action = recommendRepairAction(attempt);
    if (action !== "repair" && action !== "redo") {
      return [];
    }
    if (action === "repair" && maxRepair <= 0) {
      return [];
    }
    if (action === "redo" && maxRedo <= 0) {
      return [];
    }
    const source = attempt.taskId ? nodesById.get(attempt.taskId) : undefined;
    const taskNodeId = `${action}-${attempt.taskId ?? attempt.childRunId ?? index + 1}-1`;
    return [{
      taskNodeId,
      roleName: attempt.roleName,
      task: action === "redo"
        ? `Redo with narrower scope: ${source?.task ?? attempt.roleName}`
        : `Repair gaps for: ${source?.task ?? attempt.roleName}`,
      phase: action,
      dependsOn: attempt.taskId ? [attempt.taskId] : [],
      scope: source?.scope ?? attempt.roleName,
      requiredCapabilities: source?.requiredCapabilities ?? [],
      attemptPolicy: {
        maxRepairAttempts: maxRepair,
        maxRedoAttempts: maxRedo,
      },
      status: "planned",
      repairOf: attempt.taskId,
      repairAction: action,
      reason: action === "redo" ? "timeout-or-empty-output" : "quality-or-verifier-gap",
    } satisfies OrchestrationRepairNode];
  });
}

export function buildRerouteRecommendations(params: {
  taskGraph?: OrchestrationTaskGraph;
  routeDiagnostics?: RouteDiagnostics;
  attempts?: readonly { roleName: string; taskId?: string; status?: string; error?: string }[];
}): OrchestrationRerouteRecommendation[] {
  const fromCapabilityGaps = (params.routeDiagnostics?.capabilityGaps ?? []).map((gap) => ({
    roleName: gap.roleName,
    reason: "capability-gap",
    missingCapabilities: gap.missing,
  }));
  const fromFailures = (params.attempts ?? []).flatMap((attempt) => {
    const error = attempt.error?.toLowerCase() ?? "";
    if (!error.includes("permission") && !error.includes("forbidden")) {
      return [];
    }
    return [{
      sourceTaskNodeId: attempt.taskId,
      roleName: attempt.roleName,
      reason: "permission-denied",
    }];
  });
  return [...fromCapabilityGaps, ...fromFailures];
}

export function buildOrchestrationDiagnostics(params: {
  failures: readonly { roleName: string; status: string; error?: string }[];
  rerouteRecommendations?: readonly OrchestrationRerouteRecommendation[];
}): OrchestrationDiagnostics {
  const recommendations: OrchestrationDiagnosticsRecommendation[] = [];
  for (const failure of params.failures) {
    const error = failure.error?.trim();
    recommendations.push({
      code: "worker-spawn-failed",
      roleName: failure.roleName,
      message: error
        ? `Worker failed before acceptance: ${error}`
        : `Worker failed before acceptance with status ${failure.status}.`,
      recommendedAction: /permission|forbidden/i.test(`${failure.status} ${error ?? ""}`)
        ? "Review worker limits or permissions before retrying ordinary orchestration."
        : "Review the worker details before retrying ordinary orchestration.",
    });
  }
  for (const reroute of params.rerouteRecommendations ?? []) {
    recommendations.push({
      code: "reroute-consideration",
      roleName: reroute.roleName,
      message: `Role ${reroute.roleName} may need a different route because ${reroute.reason}.`,
      recommendedAction: "Choose an explicit role or adjust role settings before retrying ordinary orchestration.",
    });
  }

  const failedWorkerCount = params.failures.length;
  const status: OrchestrationDiagnostics["status"] = recommendations.length > 0 ? "needs_attention" : "ok";
  return {
    kind: "ordinary-orchestration-diagnostics",
    boundary: "diagnostics-only",
    status,
    summary: status === "needs_attention"
      ? `${failedWorkerCount} worker${failedWorkerCount === 1 ? "" : "s"} did not start. Ordinary orchestration is showing diagnostics only.`
      : "Ordinary orchestration completed without diagnostic recommendations.",
    failedWorkerCount,
    taskLoopUpgradeAvailable: true,
    recommendations,
    nextSteps: status === "needs_attention"
      ? [
          "Review failed worker details",
          "Explicitly start Task Loop only if a governed long-run retry is needed",
        ]
      : [],
  };
}

export function buildPendingGraphNodesFromFollowups(params: {
  followupCandidates: readonly FollowupCandidate[];
  repairPolicy?: OrchestrationRepairPolicy;
  allowFollowupPlanning?: boolean;
}): OrchestrationTaskNode[] {
  const limit = params.allowFollowupPlanning
    ? params.repairPolicy?.maxFollowupRuns ?? DEFAULT_REPAIR_POLICY.maxFollowupRuns
    : 0;
  return params.followupCandidates.slice(0, limit).map((candidate, index) => ({
    taskNodeId: `followup-${index + 1}`,
    roleName: candidate.roleName,
    task: candidate.task,
    phase: "followup",
    dependsOn: [],
    scope: candidate.task,
    requiredCapabilities: ["task-analysis"],
    attemptPolicy: {
      maxRepairAttempts: params.repairPolicy?.maxRepairAttempts ?? DEFAULT_REPAIR_POLICY.maxRepairAttempts,
      maxRedoAttempts: params.repairPolicy?.maxRedoAttempts ?? DEFAULT_REPAIR_POLICY.maxRedoAttempts,
    },
    status: "planned",
    followupOf: candidate.childRunId,
  }));
}

export function summarizeQuality(scores: readonly WorkerQualityScore[]): {
  good: number;
  needsAttention: number;
  poorAttempts: number;
} {
  return {
    good: scores.filter((score) => score.overall === "good").length,
    needsAttention: scores.filter((score) => score.overall === "needs_attention").length,
    poorAttempts: scores.filter((score) => score.overall === "poor_attempt").length,
  };
}

export function readStringArray(value: unknown): string[] {
  return cleanList(Array.isArray(value) ? value : undefined);
}
