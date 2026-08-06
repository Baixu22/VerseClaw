import { createHash } from "node:crypto";
import type { ContextItem, ContextItemKind } from "../runtime-core/types.js";
import {
  contextProviderShadowFlagEnabled,
  type RuntimeContextProviderShadowConfig,
} from "../context-engine/shadow-flags.js";
import type { ContextPack } from "../memory/types.js";
import type { RuntimeResumeCheckpoint } from "./long-task-control/store.js";

export type LoopContextSectionId =
  | "systemAppRules"
  | "projectRules"
  | "initialConstraints"
  | "userInterventions"
  | "architecturePrinciples"
  | "taskLedgerCurrentState"
  | "resumeCheckpoint"
  | "relevantKnowledge"
  | "roleMemory"
  | "transcriptSummary";

export type LoopContextItemPriority = "P0" | "P1" | "P2";

export type LoopContextPackBudget = {
  totalTokens: number;
  itemTokens: number;
  sectionTokens: Record<LoopContextSectionId, number>;
};

export type LoopContextTextSource = {
  text: string;
  source?: string;
  priority?: LoopContextItemPriority;
};

export type LoopContextUserIntervention = {
  text: string;
  source?: string;
  createdAt?: string;
  supersedes?: string;
};

export type LoopContextDesignDecision = {
  decision: string;
  rationale?: string;
  source?: string;
};

export type LoopContextCurrentTask = {
  goal?: string;
  acceptance?: string[];
};

export type LoopContextPackInput = {
  loopId?: string;
  sessionKey?: string;
  agentId?: string;
  systemAppRules?: Array<LoopContextTextSource | string>;
  projectRules?: Array<LoopContextTextSource | string>;
  initialConstraints?: Array<LoopContextTextSource | string>;
  userInterventions?: Array<LoopContextUserIntervention | string>;
  architecturePrinciples?: Array<LoopContextTextSource | string>;
  keyDesignDecisions?: Array<LoopContextDesignDecision | string>;
  currentTask?: LoopContextCurrentTask;
  taskLedgerState?: Array<LoopContextTextSource | string>;
  resumeCheckpoint?: RuntimeResumeCheckpoint | string;
  relevantKnowledge?: Array<LoopContextTextSource | string>;
  roleMemory?: Array<LoopContextTextSource | string>;
  memoryContextPack?: ContextPack;
  transcriptSummary?: Array<LoopContextTextSource | string>;
  runtime?: RuntimeContextProviderShadowConfig;
  budget?: Partial<LoopContextPackBudget> & {
    sectionTokens?: Partial<Record<LoopContextSectionId, number>>;
  };
};

export type LoopContextPackItem = {
  id: string;
  text: string;
  source: string;
  priority: LoopContextItemPriority;
  protected: boolean;
  estimatedTokens: number;
  truncated: boolean;
  omitted?: boolean;
  supersedes?: string;
  createdAt?: string;
};

export type LoopContextPackSection = {
  id: LoopContextSectionId;
  title: string;
  order: number;
  items: LoopContextPackItem[];
  omittedItems: LoopContextPackItem[];
  estimatedTokens: number;
  truncated: boolean;
};

export type LoopContextPack = {
  schemaVersion: 1;
  loopId?: string;
  sessionKey?: string;
  agentId?: string;
  priorityOrder: LoopContextSectionId[];
  sections: LoopContextPackSection[];
  budget: LoopContextPackBudget;
  estimatedTokens: number;
  truncated: boolean;
  overflowTokens: number;
  p0Preserved: boolean;
  contextItems?: ContextItem[];
  hash: string;
};

export const LOOP_CONTEXT_SECTION_ORDER: readonly LoopContextSectionId[] = [
  "systemAppRules",
  "projectRules",
  "initialConstraints",
  "userInterventions",
  "architecturePrinciples",
  "taskLedgerCurrentState",
  "resumeCheckpoint",
  "relevantKnowledge",
  "roleMemory",
  "transcriptSummary",
];

const SECTION_TITLES: Record<LoopContextSectionId, string> = {
  systemAppRules: "System/App Rules",
  projectRules: "Project Rules",
  initialConstraints: "/loop initial constraints",
  userInterventions: "user interventions",
  architecturePrinciples: "Architecture Principles",
  taskLedgerCurrentState: "Task Ledger current state",
  resumeCheckpoint: "ResumeCheckpoint",
  relevantKnowledge: "relevant Knowledge",
  roleMemory: "Role Memory",
  transcriptSummary: "transcript summary",
};

export const DEFAULT_LOOP_CONTEXT_PACK_BUDGET: LoopContextPackBudget = {
  totalTokens: 5_000,
  itemTokens: 800,
  sectionTokens: {
    systemAppRules: 700,
    projectRules: 700,
    initialConstraints: 900,
    userInterventions: 900,
    architecturePrinciples: 700,
    taskLedgerCurrentState: 800,
    resumeCheckpoint: 700,
    relevantKnowledge: 600,
    roleMemory: 500,
    transcriptSummary: 500,
  },
};

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeBudget(input?: LoopContextPackInput["budget"]): LoopContextPackBudget {
  return {
    totalTokens: Math.max(1, Math.floor(input?.totalTokens ?? DEFAULT_LOOP_CONTEXT_PACK_BUDGET.totalTokens)),
    itemTokens: Math.max(1, Math.floor(input?.itemTokens ?? DEFAULT_LOOP_CONTEXT_PACK_BUDGET.itemTokens)),
    sectionTokens: {
      ...DEFAULT_LOOP_CONTEXT_PACK_BUDGET.sectionTokens,
      ...input?.sectionTokens,
    },
  };
}

function normalizeTextSources(
  values: Array<LoopContextTextSource | string> | undefined,
  source: string,
  priority: LoopContextItemPriority,
): LoopContextTextSource[] {
  return (values ?? []).flatMap((value) => {
    if (typeof value === "string") {
      const text = value.trim();
      return text ? [{ text, source, priority }] : [];
    }
    const text = value.text.trim();
    return text ? [{ ...value, text, source: value.source ?? source, priority: value.priority ?? priority }] : [];
  });
}

function formatResumeCheckpoint(checkpoint: RuntimeResumeCheckpoint | string | undefined): LoopContextTextSource[] {
  if (!checkpoint) return [];
  if (typeof checkpoint === "string") {
    const text = checkpoint.trim();
    return text ? [{ text, source: "resume_checkpoint", priority: "P1" }] : [];
  }
  const lines = [
    checkpoint.objective ? `Objective: ${checkpoint.objective}` : "",
    checkpoint.activeTask ? `Active task: ${checkpoint.activeTask}` : "",
    checkpoint.lastConfirmedHandoff ? `Last handoff: ${checkpoint.lastConfirmedHandoff}` : "",
    checkpoint.decisions.length ? `Decisions: ${checkpoint.decisions.join("; ")}` : "",
    checkpoint.deviations.length ? `Deviations: ${checkpoint.deviations.join("; ")}` : "",
    checkpoint.openBlockers.length ? `Open blockers: ${checkpoint.openBlockers.join("; ")}` : "",
    checkpoint.filesTouched.length ? `Files touched: ${checkpoint.filesTouched.join("; ")}` : "",
    checkpoint.testsRun.length ? `Tests run: ${checkpoint.testsRun.join("; ")}` : "",
    checkpoint.reviewNeededItems.length ? `Review needed: ${checkpoint.reviewNeededItems.join("; ")}` : "",
    checkpoint.nextAction ? `Next action: ${checkpoint.nextAction}` : "",
  ].filter(Boolean);
  return lines.length ? [{ text: lines.join("\n"), source: "resume_checkpoint", priority: "P1" }] : [];
}

function memoryText(pack: ContextPack | undefined, buckets: Array<keyof ContextPack["buckets"]>): string[] {
  if (!pack) return [];
  return buckets.flatMap((bucket) => pack.buckets[bucket] ?? []);
}

function truncateNonProtected(text: string, maxTokens: number): { text: string; truncated: boolean } {
  const maxChars = Math.max(4, maxTokens * 4);
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, Math.max(0, maxChars - 80))}\n[truncated ${text.length - maxChars} chars]`,
    truncated: true,
  };
}

function itemId(sectionId: LoopContextSectionId, index: number): string {
  return `${sectionId}:${index + 1}`;
}

function makeItem(
  sectionId: LoopContextSectionId,
  index: number,
  source: LoopContextTextSource,
  p0 = false,
  extra?: Pick<LoopContextPackItem, "createdAt" | "supersedes">,
): LoopContextPackItem {
  const text = source.text.trim();
  return {
    id: itemId(sectionId, index),
    text,
    source: source.source ?? sectionId,
    priority: p0 ? "P0" : source.priority ?? "P2",
    protected: p0 || source.priority === "P0",
    estimatedTokens: estimateTokens(text),
    truncated: false,
    ...(extra?.createdAt ? { createdAt: extra.createdAt } : {}),
    ...(extra?.supersedes ? { supersedes: extra.supersedes } : {}),
  };
}

function buildRawItems(input: LoopContextPackInput): Record<LoopContextSectionId, LoopContextPackItem[]> {
  const raw: Record<LoopContextSectionId, LoopContextPackItem[]> = {
    systemAppRules: [],
    projectRules: [],
    initialConstraints: [],
    userInterventions: [],
    architecturePrinciples: [],
    taskLedgerCurrentState: [],
    resumeCheckpoint: [],
    relevantKnowledge: [],
    roleMemory: [],
    transcriptSummary: [],
  };

  raw.systemAppRules = normalizeTextSources(input.systemAppRules, "system_app_rules", "P1")
    .map((source, index) => makeItem("systemAppRules", index, source));
  raw.projectRules = normalizeTextSources(input.projectRules, "project_rules", "P1")
    .map((source, index) => makeItem("projectRules", index, source));

  const initial = [
    ...normalizeTextSources(input.initialConstraints, "loop_initial_constraints", "P0"),
    ...(input.currentTask?.goal ? [{ text: `Current task goal: ${input.currentTask.goal}`, source: "current_task", priority: "P0" as const }] : []),
    ...((input.currentTask?.acceptance ?? []).map((item) => ({
      text: `Acceptance: ${item}`,
      source: "current_task",
      priority: "P0" as const,
    }))),
  ];
  raw.initialConstraints = initial.map((source, index) => makeItem("initialConstraints", index, source, true));

  raw.userInterventions = (input.userInterventions ?? []).flatMap((value, index) => {
    const intervention = typeof value === "string" ? { text: value } : value;
    const text = intervention.text.trim();
    if (!text) return [];
    return [makeItem(
      "userInterventions",
      index,
      { text, source: intervention.source ?? "user_intervention", priority: "P0" },
      true,
      { createdAt: intervention.createdAt, supersedes: intervention.supersedes },
    )];
  });

  const architecture = [
    ...normalizeTextSources(input.architecturePrinciples, "architecture_principles", "P0"),
    ...((input.keyDesignDecisions ?? []).flatMap((value) => {
      if (typeof value === "string") return [{ text: value, source: "design_decision", priority: "P0" as const }];
      const decision = value.decision.trim();
      if (!decision) return [];
      const text = value.rationale?.trim()
        ? `Decision: ${decision}\nReason: ${value.rationale.trim()}`
        : `Decision: ${decision}`;
      return [{ text, source: value.source ?? "design_decision", priority: "P0" as const }];
    })),
  ];
  raw.architecturePrinciples = architecture.map((source, index) => makeItem("architecturePrinciples", index, source, true));

  raw.taskLedgerCurrentState = normalizeTextSources(input.taskLedgerState, "task_ledger", "P1")
    .map((source, index) => makeItem("taskLedgerCurrentState", index, source));
  raw.resumeCheckpoint = formatResumeCheckpoint(input.resumeCheckpoint)
    .map((source, index) => makeItem("resumeCheckpoint", index, source));

  raw.relevantKnowledge = [
    ...normalizeTextSources(input.relevantKnowledge, "knowledge", "P2"),
    ...memoryText(input.memoryContextPack, ["projectFacts", "teamHandoffs", "recentEpisodes", "openConflicts"])
      .map((text) => ({ text, source: "memory_context_pack", priority: "P2" as const })),
  ].map((source, index) => makeItem("relevantKnowledge", index, source));

  raw.roleMemory = [
    ...normalizeTextSources(input.roleMemory, "role_memory", "P2"),
    ...memoryText(input.memoryContextPack, ["hardConstraints", "rolePlaybook"])
      .map((text) => ({ text, source: "memory_context_pack", priority: "P2" as const })),
  ].map((source, index) => makeItem("roleMemory", index, source));

  raw.transcriptSummary = normalizeTextSources(input.transcriptSummary, "transcript_summary", "P2")
    .map((source, index) => makeItem("transcriptSummary", index, source));

  return raw;
}

function digestPack(pack: Omit<LoopContextPack, "contextItems" | "hash">): string {
  return createHash("sha256").update(JSON.stringify(pack)).digest("hex");
}

function contextItemKindForSection(sectionId: LoopContextSectionId): ContextItemKind {
  switch (sectionId) {
    case "systemAppRules":
    case "projectRules":
    case "initialConstraints":
    case "userInterventions":
    case "architecturePrinciples":
      return "instruction";
    case "resumeCheckpoint":
      return "checkpoint";
    case "relevantKnowledge":
    case "roleMemory":
      return "memory";
    case "taskLedgerCurrentState":
      return "evidence";
    case "transcriptSummary":
      return "summary";
  }
}

function loopContextItemToContextItem(params: {
  section: LoopContextPackSection;
  item: LoopContextPackItem;
  omitted: boolean;
}): ContextItem {
  const sourceId = `${params.section.id}:${params.item.id}`;
  const contextItemId = `loop_context_pack:${sourceId}`;
  return {
    id: contextItemId,
    kind: contextItemKindForSection(params.section.id),
    text: params.item.text,
    source: params.item.source,
    priority: params.item.priority,
    evidenceRefs: [{
      type: "other",
      ref: contextItemId,
      label: params.section.title,
      summary: params.item.source,
    }],
    metadata: {
      sourceId,
      sourceKind: params.section.id,
      sectionTitle: params.section.title,
      tokenEstimate: params.item.estimatedTokens,
      truncated: params.item.truncated,
      omitted: params.omitted,
      protected: params.item.protected,
      ...(params.item.createdAt ? { createdAt: params.item.createdAt } : {}),
      ...(params.item.supersedes ? { supersedes: params.item.supersedes } : {}),
    },
  };
}

function buildLoopContextItems(pack: Omit<LoopContextPack, "contextItems">): ContextItem[] {
  return pack.sections.flatMap((section) => [
    ...section.items.map((item) => loopContextItemToContextItem({ section, item, omitted: false })),
    ...section.omittedItems.map((item) => loopContextItemToContextItem({ section, item, omitted: true })),
  ]);
}

export function buildLoopContextPack(input: LoopContextPackInput): LoopContextPack {
  const budget = normalizeBudget(input.budget);
  const rawItems = buildRawItems(input);
  const sections: LoopContextPackSection[] = [];
  let total = 0;
  let truncated = false;
  let p0Preserved = true;

  LOOP_CONTEXT_SECTION_ORDER.forEach((sectionId, order) => {
    const items: LoopContextPackItem[] = [];
    const omittedItems: LoopContextPackItem[] = [];
    let sectionTotal = 0;
    let sectionTruncated = false;

    for (const rawItem of rawItems[sectionId]) {
      const prepared = rawItem.protected
        ? rawItem
        : {
            ...rawItem,
            ...truncateNonProtected(rawItem.text, budget.itemTokens),
          };
      prepared.estimatedTokens = estimateTokens(prepared.text);
      const wouldExceedSection = sectionTotal + prepared.estimatedTokens > budget.sectionTokens[sectionId];
      const wouldExceedTotal = total + prepared.estimatedTokens > budget.totalTokens;
      if (!prepared.protected && (wouldExceedSection || wouldExceedTotal)) {
        omittedItems.push({ ...prepared, omitted: true, truncated: true });
        sectionTruncated = true;
        truncated = true;
        continue;
      }
      if (prepared.protected && !prepared.text.trim()) {
        p0Preserved = false;
        continue;
      }
      items.push(prepared);
      sectionTotal += prepared.estimatedTokens;
      total += prepared.estimatedTokens;
      sectionTruncated ||= prepared.truncated;
      truncated ||= prepared.truncated;
    }

    sections.push({
      id: sectionId,
      title: SECTION_TITLES[sectionId],
      order,
      items,
      omittedItems,
      estimatedTokens: sectionTotal,
      truncated: sectionTruncated,
    });
  });

  const pack = {
    schemaVersion: 1 as const,
    ...(input.loopId ? { loopId: input.loopId } : {}),
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    priorityOrder: [...LOOP_CONTEXT_SECTION_ORDER],
    sections,
    budget,
    estimatedTokens: total,
    truncated,
    overflowTokens: Math.max(0, total - budget.totalTokens),
    p0Preserved,
  };
  const hashed = { ...pack, hash: digestPack(pack) };
  const includeShadow = contextProviderShadowFlagEnabled(input, "shadow")
    || contextProviderShadowFlagEnabled(input, "loopPackShadow");
  return {
    ...hashed,
    ...(includeShadow ? { contextItems: buildLoopContextItems(hashed) } : {}),
  };
}

export function getLoopContextSection(pack: LoopContextPack, id: LoopContextSectionId): LoopContextPackSection {
  return pack.sections.find((section) => section.id === id)
    ?? {
      id,
      title: SECTION_TITLES[id],
      order: LOOP_CONTEXT_SECTION_ORDER.indexOf(id),
      items: [],
      omittedItems: [],
      estimatedTokens: 0,
      truncated: false,
    };
}

export function formatLoopContextPackForPrompt(pack: LoopContextPack): string {
  const rendered = pack.sections.flatMap((section) => {
    if (section.items.length === 0) return [];
    return [
      `## ${section.title}`,
      ...section.items.map((item) => {
        const meta = [
          item.priority,
          item.source,
          item.supersedes ? `supersedes=${item.supersedes}` : "",
          item.createdAt ? `createdAt=${item.createdAt}` : "",
        ].filter(Boolean).join("; ");
        return `- [${meta}] ${item.text}`;
      }),
    ];
  });
  return [
    "LoopContextPack priority order: System/App Rules > Project Rules > /loop initial constraints > user interventions > Architecture Principles > Task Ledger current state > ResumeCheckpoint > relevant Knowledge > Role Memory > transcript summary.",
    "Earlier sections take precedence over later sections when conflicts exist.",
    `estimatedTokens: ${pack.estimatedTokens}/${pack.budget.totalTokens}`,
    pack.overflowTokens > 0 ? `budgetOverflowTokens: ${pack.overflowTokens}` : "",
    pack.truncated ? "truncated: true" : "truncated: false",
    "",
    ...rendered,
  ].filter(Boolean).join("\n");
}
