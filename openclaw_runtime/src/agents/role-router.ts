import {
  BUILT_IN_ROLE_CONTRACTS,
  type RoleContract,
} from "./role-contract.js";

export type RoleRouteMode = "router" | "lead-workers" | "adversarial-review";

export type RoleRouteRequest = {
  task: string;
  mode?: RoleRouteMode;
  availableRoles?: readonly RoleContract[];
  fileHints?: string[];
  important?: boolean;
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

function scoreRole(role: RoleContract, task: string, fileHints: readonly string[]): RoleRouteMatch {
  const normalized = normalizeTask(task);
  const reasons: string[] = [];
  let score = 0;
  for (const keyword of ROLE_KEYWORDS[role.name] ?? []) {
    if (normalized.includes(keyword.toLowerCase())) {
      score += 2;
      reasons.push(`matched:${keyword}`);
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
  const matches = roles
    .map((role) => scoreRole(role, request.task, fileHints))
    .sort((left, right) => right.score - left.score || left.role.name.localeCompare(right.role.name));
  const primary = matches[0] ?? scoreRole(BUILT_IN_ROLE_CONTRACTS[2], request.task, fileHints);
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
