export type ComplexityGateMode =
  | "single-agent"
  | "role-routed"
  | "team-orchestrated"
  | "runbook-orchestrated";

export type ComplexityGateInput = {
  task: string;
  fileHints?: readonly string[];
  explicitTeamRequested?: boolean;
  explicitRunbookId?: string;
  riskHints?: readonly string[];
  capabilityHints?: readonly string[];
  toolHints?: readonly string[];
  priorFailureCount?: number;
};

export type ComplexityGateSignal = {
  name: string;
  value: string | number | boolean;
};

export type ComplexityGateDecision = {
  mode: ComplexityGateMode;
  confidence: number;
  selectedRunbookId?: string;
  signals: ComplexityGateSignal[];
  reasons: string[];
  warnings: string[];
};

function cleanList(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function boundedConfidence(value: number): number {
  return Math.max(0.35, Math.min(0.95, Number(value.toFixed(2))));
}

export function classifyComplexity(input: ComplexityGateInput): ComplexityGateDecision {
  const task = input.task.trim();
  if (!task) {
    throw new Error("ComplexityGateInput.task is required");
  }

  const fileHints = cleanList(input.fileHints);
  const riskHints = cleanList(input.riskHints);
  const capabilityHints = cleanList(input.capabilityHints);
  const toolHints = cleanList(input.toolHints);
  const priorFailureCount = Math.max(0, Math.floor(input.priorFailureCount ?? 0));
  const taskWordCount = task.split(/\s+/).filter(Boolean).length;
  const capabilityFamilyCount = new Set(capabilityHints.map((hint) => hint.toLowerCase())).size;
  const selectedRunbookId = input.explicitRunbookId?.trim() || undefined;

  const signals: ComplexityGateSignal[] = [
    { name: "taskWordCount", value: taskWordCount },
    { name: "fileHintCount", value: fileHints.length },
    { name: "riskHintCount", value: riskHints.length },
    { name: "capabilityFamilyCount", value: capabilityFamilyCount },
    { name: "toolHintCount", value: toolHints.length },
    { name: "priorFailureCount", value: priorFailureCount },
    { name: "explicitTeamRequested", value: input.explicitTeamRequested === true },
    { name: "explicitRunbookRequested", value: selectedRunbookId !== undefined },
  ];
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (selectedRunbookId) {
    reasons.push("explicit-runbook-requested");
    return {
      mode: "runbook-orchestrated",
      confidence: 0.95,
      selectedRunbookId,
      signals,
      reasons,
      warnings,
    };
  }

  if (input.explicitTeamRequested) {
    reasons.push("explicit-team-requested");
    if (fileHints.length === 0 && riskHints.length === 0 && taskWordCount <= 6) {
      warnings.push("team orchestration may add cost for a simple task");
    }
    return {
      mode: "team-orchestrated",
      confidence: boundedConfidence(0.82 - warnings.length * 0.08),
      signals,
      reasons,
      warnings,
    };
  }

  if (priorFailureCount >= 2) {
    reasons.push("repeated-prior-failures");
    return {
      mode: "runbook-orchestrated",
      confidence: boundedConfidence(0.86 + Math.min(0.08, priorFailureCount * 0.02)),
      selectedRunbookId: "test-repair",
      signals,
      reasons,
      warnings,
    };
  }

  if (fileHints.length >= 2) {
    reasons.push("multi-file-scope");
  }
  if (riskHints.length > 0) {
    reasons.push("risk-hints");
  }
  if (capabilityFamilyCount >= 2) {
    reasons.push("cross-capability-work");
  }
  if (toolHints.length >= 2) {
    reasons.push("multiple-tool-needs");
  }

  const teamScore =
    (fileHints.length >= 2 ? 2 : 0) +
    (riskHints.length > 0 ? 2 : 0) +
    (capabilityFamilyCount >= 2 ? 1 : 0) +
    (toolHints.length >= 2 ? 1 : 0) +
    (taskWordCount >= 18 ? 1 : 0);
  if (teamScore >= 3) {
    return {
      mode: "team-orchestrated",
      confidence: boundedConfidence(0.68 + teamScore * 0.04),
      signals,
      reasons,
      warnings,
    };
  }
  if (capabilityFamilyCount > 0 || fileHints.length === 1 || taskWordCount >= 7) {
    return {
      mode: "role-routed",
      confidence: boundedConfidence(0.62 + Math.min(0.12, capabilityFamilyCount * 0.04)),
      signals,
      reasons: reasons.length ? reasons : ["role-routing-sufficient"],
      warnings,
    };
  }

  return {
    mode: "single-agent",
    confidence: 0.74,
    signals,
    reasons: ["simple-task"],
    warnings,
  };
}
