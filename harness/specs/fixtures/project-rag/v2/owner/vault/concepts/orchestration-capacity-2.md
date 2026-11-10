---
title: orchestration-capacity / openclaw_runtime/src/agents/role-router.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-09T23:01:31.258Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: openclaw_runtime/src/agents/role-router.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
import {
  BUILT_IN_ROLE_CONTRACTS,
  type RoleContract,
} from "./role-contract.js";
import {
  buildMemoActiveAdjustment,
  type RoutingMemoMatch,
  type RoutingMemoPilotMode,
} from "./routing-memo.js";

export type RoleRouteMode = "router" | "lead-workers" | "adversarial-review";

export type RoleRouteRequest = {
  task: string;
  mode?: RoleRouteMode;
  availableRoles?: readonly RoleContract[];
  fileHints?: string[];
  important?: boolean;
  /**
   * Area 3 §3.1: optional routing memo signal. When `mode === 'active'`, the
   * top recalled memo applies a bounded ±2/−1 score adjustment to the matching
   * role (keyword evidence stays dominant — memos nudge, never dictate). When
   * `mode === 'shadow'`, scores are unchanged (shadow reasons are added by the
   * caller via `buildMemoShadowReason`). Undefined → today's routing unchanged.
   */
  memoSignal?: {
    matches: RoutingMemoMatch[];
    mode: RoutingMemoPilotMode;
  };
};

export type RoleRouteMatch = {
  role: RoleContract;
  score: number;
  reasons: string[];
};

export type RoleRouteResult = {
  mode: RoleRouteMode;
  primary: RoleRouteMatch;
  supporting: RoleRouteMatch[];
};

const ROLE_KEYWORDS: Record<string, readonly string[]> = {
  planner: ["plan", "规划", "计划", "breakdown", "拆解", "roadmap", "sequence"],
  architect: ["architecture", "架构", "design", "接口", "boundary", "tradeoff", "system"],
  implementer: ["implement", "实现", "fix", "修复", "add", "update", "code", "mvp"],
  tester: ["test", "验证", "verify", "coverage", "用例", "失败", "repro"],
  reviewer: ["review", "审查", "cleanup", "refactor", "regression", "diff"],
  "security-reviewer": ["security", "安全", "auth", "权限", "secret", "credential", "token", "漏洞"],
  "docs-writer": ["docs", "文档", "readme", "guide", "说明", "changelog"],
  skeptic: ["skeptic", "质疑", "对抗", "风险", "refute", "acceptance", "验收"],
};

function normalizeTask(task: string): string {
  return task.toLowerCase();
}

function scoreRole(
  role: RoleContract,
  task: string,
  fileHints: readonly string[],
  memoSignal?: RoleRouteRequest["memoSignal"],
): RoleRouteMatch {
  const normalized = normalizeTask(task);
  const reasons: string[] = [];
  let score = 0;
  for (const keyword of ROLE_KEYWORDS[role.name] ?? []) {
    if (normalized.includes(keyword.toLowerCase())) {
      score += 2;
      reasons.push(`matched:${keyword}`);
    }
  }
  // Area 3 §3.5: config-defined (pack) roles declare their own routing keywords
  // via `RoleContract.routingKeywords`. Same +2 weight as built-in keywords so
  // pack roles are routable on equal footing without modifying the static table.
  for (const keyword of role.routingKeywords ?? []) {
    const lowered = keyword.toLowerCase();
    if (lowered && normalized.includes(lowered)) {
      score += 2;
      reasons.push(`routing-keyword:${keyword}`);
    }
  }
  for (const tag of role.tags ?? []) {
    if (normalized.includes(tag.toLowerCase())) {
      score += 1;
      reasons.push(`tag:${tag}`);
    }
  }
  if (role.name === "tester" && fileHints.some((file) => /test|spec/i.test(file))) {
    score += 2;
    reasons.push("test-file-hint");
  }
  if (role.name === "docs-writer" && fileHints.some((file) => /readme|docs?|\.md$/i.test(file))) {
    score += 2;
    reasons.push("docs-file-hint");
  }
  if (role.name === "security-reviewer" && fileHints.some((file) => /auth|token|secret|permission|security/i.test(file))) {
    score += 3;
    reasons.push("security-file-hint");
  }
  if (role.name === "implementer") {
    score += 1;
    reasons.push("default-execution-role");
  }
  // Area 3 §3.1: apply bounded memo score adjustment in active phase only.
  // Shadow phase leaves scores unchanged (byte-identical routing); shadow
  // reasons are added by the caller. Only the top recalled memo matching this
  // role's lead contributes — bounded magnitudes keep keyword evidence dominant.
  if (memoSignal && memoSignal.mode === "active" && memoSignal.matches.length > 0) {
    const topMatch = memoSignal.matches[0];
    if (topMatch.memo.leadRole === role.name) {
      const adjustment = buildMemoActiveAdjustment(topMatch);
      if (adjustment) {
        score += adjustment.delta;
        reasons.push(adjustment.reason);
      }
    }
  }
  return { role, score, reasons };
}

function resolveMode(request: RoleRouteRequest): RoleRouteMode {
  if (request.mode) {
    return request.mode;
  }
  const task = normalizeTask(request.task);
  if (
    request.important ||
    /security|安全|auth|credential|secret|权限|release|发布/.test(task)
  ) {
    return "adversarial-review";
  }
  if ((request.fileHints?.length ?? 0) >= 3 || /refactor|重构|module|模块|multi-file|跨/.test(task)) {
    return "lead-workers";
  }
  return "router";
}

export function routeRole(request: RoleRouteRequest): RoleRouteResult {
  const roles = request.availableRoles?.length ? request.availableRoles : BUILT_IN_ROLE_CONTRACTS;
  const fileHints = request.fileHints ?? [];
  const memoSignal = request.memoSignal;
  const matches = roles
    .map((role) => scoreRole(role, request.task, fileHints, memoSignal))
    .sort((left, right) => right.score - left.score || left.role.name.localeCompare(right.role.name));
  const primary = matches[0] ?? scoreRole(BUILT_IN_ROLE_CONTRACTS[2], request.task, fileHints, memoSignal);
  const mode = resolveMode(request);
  const supportingNames = mode === "router"
    ? []
    : mode === "lead-workers"
      ? ["planner", "architect", "implementer", "tester", "reviewer"]
      : ["implementer", "tester", "reviewer", "security-reviewer", "skeptic"];
  const supporting = supportingNames
    .map((name) => matches.find((match) => match.role.name === name))
    .filter((match): match is RoleRouteMatch => Boolean(match));
  return { mode, primary, supporting };
}

export function routeRoleName(task: string): string {
  return routeRole({ task }).primary.role.name;
}

~~~
