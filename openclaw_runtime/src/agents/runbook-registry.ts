import type { RunbookTemplate } from "./runbook-template.js";

export type RunbookSelectionInput = {
  task: string;
  explicitRunbookId?: string;
  suppressSelection?: boolean;
  priorFailureCount?: number;
  riskHints?: readonly string[];
  fileHints?: readonly string[];
};

export type RunbookSelectionDetail = {
  runbookId: string;
  reasons: string[];
};

export type SelectedRunbookDetail = RunbookSelectionDetail & {
  template: RunbookTemplate;
};

export type RunbookSelectionResult = {
  selected?: SelectedRunbookDetail;
  unselected: RunbookSelectionDetail[];
};

export const BUILT_IN_RUNBOOK_TEMPLATES: readonly RunbookTemplate[] = [
  {
    id: "code-review",
    version: "1.0.0",
    title: "Code Review",
    intent: ["review", "code review", "quality"],
    requiredRoles: ["reviewer"],
    optionalRoles: ["tester", "skeptic"],
    graph: {
      nodes: [
        { id: "review", roleName: "reviewer", task: "Review code quality, risks, and evidence" },
        {
          id: "verify-review",
          roleName: "skeptic",
          task: "Challenge review conclusions with evidence",
          dependsOn: ["review"],
          verifier: true,
        },
      ],
    },
    verification: {
      verifierRole: "skeptic",
      expectedEvidence: ["changed files", "test evidence", "risk findings"],
    },
    handoff: {
      rules: ["reviewer hands off findings to skeptic for challenge"],
    },
  },
  {
    id: "feature-implementation",
    version: "1.0.0",
    title: "Feature Implementation",
    intent: ["feature", "implement", "add"],
    requiredRoles: ["planner", "implementer", "tester"],
    optionalRoles: ["reviewer"],
    graph: {
      nodes: [
        { id: "plan", roleName: "planner", task: "Plan feature scope and acceptance criteria" },
        {
          id: "implement",
          roleName: "implementer",
          task: "Implement the feature within the planned scope",
          dependsOn: ["plan"],
        },
        {
          id: "test",
          roleName: "tester",
          task: "Verify feature behavior and regression coverage",
          dependsOn: ["implement"],
        },
        {
          id: "review",
          roleName: "reviewer",
          task: "Review implementation and verification evidence",
          dependsOn: ["test"],
          verifier: true,
        },
      ],
    },
    verification: {
      verifierRole: "reviewer",
      expectedEvidence: ["acceptance criteria", "changed files", "focused tests"],
    },
    handoff: {
      rules: ["planner hands off scope to implementer", "tester hands verification to reviewer"],
    },
  },
  {
    id: "security-check",
    version: "1.0.0",
    title: "Security Check",
    intent: ["security", "auth", "permission", "secret"],
    requiredRoles: ["security-reviewer", "reviewer"],
    optionalRoles: ["skeptic", "tester"],
    graph: {
      nodes: [
        { id: "security-review", roleName: "security-reviewer", task: "Inspect security and permission risks" },
        {
          id: "quality-review",
          roleName: "reviewer",
          task: "Review implementation quality and evidence",
          dependsOn: ["security-review"],
        },
        {
          id: "challenge",
          roleName: "skeptic",
          task: "Challenge security conclusions and unresolved risks",
          dependsOn: ["quality-review"],
          verifier: true,
        },
      ],
    },
    verification: {
      verifierRole: "skeptic",
      expectedEvidence: ["security-sensitive files", "permission analysis", "verification result"],
    },
    handoff: {
      rules: ["security-reviewer findings must be reviewed before acceptance"],
    },
  },
  {
    id: "documentation-migration",
    version: "1.0.0",
    title: "Documentation Migration",
    intent: ["documentation", "docs", "readme", "migration"],
    requiredRoles: ["planner", "docs-writer", "reviewer"],
    optionalRoles: ["tester"],
    graph: {
      nodes: [
        { id: "plan-docs", roleName: "planner", task: "Plan documentation migration scope" },
        {
          id: "write-docs",
          roleName: "docs-writer",
          task: "Update documentation according to the plan",
          dependsOn: ["plan-docs"],
        },
        {
          id: "review-docs",
          roleName: "reviewer",
          task: "Review documentation consistency and evidence",
          dependsOn: ["write-docs"],
          verifier: true,
        },
      ],
    },
    verification: {
      verifierRole: "reviewer",
      expectedEvidence: ["updated docs", "linked behavior or command references"],
    },
    handoff: {
      rules: ["docs-writer hands changed documentation to reviewer"],
    },
  },
  {
    id: "test-repair",
    version: "1.0.0",
    title: "Test Repair",
    intent: ["test repair", "failing test", "flaky", "regression"],
    requiredRoles: ["tester", "implementer", "reviewer"],
    optionalRoles: ["skeptic"],
    graph: {
      nodes: [
        { id: "diagnose", roleName: "tester", task: "Reproduce and diagnose failing tests" },
        {
          id: "repair",
          roleName: "implementer",
          task: "Implement the smallest repair for the diagnosed failure",
          dependsOn: ["diagnose"],
        },
        {
          id: "verify",
          roleName: "tester",
          task: "Rerun focused verification for the repair",
          dependsOn: ["repair"],
        },
        {
          id: "review",
          roleName: "reviewer",
          task: "Review repair evidence and regression risk",
          dependsOn: ["verify"],
          verifier: true,
        },
      ],
    },
    verification: {
      verifierRole: "reviewer",
      expectedEvidence: ["failing test before repair", "passing test after repair", "changed files"],
    },
    handoff: {
      rules: ["tester diagnosis gates implementer repair", "reviewer verifies repaired evidence"],
    },
  },
];

export function listRunbookTemplates(): readonly RunbookTemplate[] {
  return BUILT_IN_RUNBOOK_TEMPLATES;
}

function normalizeText(input: RunbookSelectionInput): string {
  return [
    input.task,
    ...(input.riskHints ?? []),
    ...(input.fileHints ?? []),
  ].join(" ").toLowerCase();
}

function scoreRunbook(template: RunbookTemplate, input: RunbookSelectionInput): RunbookSelectionDetail {
  const text = normalizeText(input);
  const reasons: string[] = [];
  if (input.explicitRunbookId === template.id) {
    reasons.push("explicit-runbook-match");
  }
  if (template.id === "test-repair" && (input.priorFailureCount ?? 0) >= 2) {
    reasons.push("prior-failure-match");
  }
  for (const matcher of template.intent) {
    if (text.includes(matcher.toLowerCase())) {
      reasons.push(`intent:${matcher}`);
    }
  }
  if (template.id === "security-check" && /security|auth|secret|permission/.test(text)) {
    reasons.push("risk-keyword-match");
  }
  return {
    runbookId: template.id,
    reasons: reasons.length ? reasons : ["no-intent-match"],
  };
}

export function selectRunbookCandidates(input: RunbookSelectionInput): RunbookSelectionResult {
  if (input.suppressSelection) {
    return {
      unselected: BUILT_IN_RUNBOOK_TEMPLATES.map((template) => ({
        runbookId: template.id,
        reasons: scoreRunbook(template, input).reasons,
      })),
    };
  }

  if (input.explicitRunbookId) {
    const explicit = BUILT_IN_RUNBOOK_TEMPLATES.find((template) => template.id === input.explicitRunbookId);
    if (!explicit) {
      return {
        unselected: [
          { runbookId: input.explicitRunbookId, reasons: ["explicit-runbook-not-found"] },
          ...BUILT_IN_RUNBOOK_TEMPLATES.map((template) => ({ runbookId: template.id, reasons: ["explicit-runbook-mismatch"] })),
        ],
      };
    }
    return {
      selected: { ...scoreRunbook(explicit, input), template: explicit },
      unselected: BUILT_IN_RUNBOOK_TEMPLATES
        .filter((template) => template.id !== explicit.id)
        .map((template) => ({ runbookId: template.id, reasons: ["explicit-runbook-mismatch"] })),
    };
  }

  const scored = BUILT_IN_RUNBOOK_TEMPLATES.map((template) => ({
    detail: scoreRunbook(template, input),
    template,
  }));
  const selected = scored
    .filter((entry) => !entry.detail.reasons.includes("no-intent-match"))
    .sort((left, right) => right.detail.reasons.length - left.detail.reasons.length)[0];

  return {
    ...(selected ? { selected: { ...selected.detail, template: selected.template } } : {}),
    unselected: scored
      .filter((entry) => entry.template.id !== selected?.template.id)
      .map((entry) => entry.detail),
  };
}
