// Role permissions → concrete tool deny/allow lists.
//
// Maps role.permissions.filesystem / network / commands into tool deny lists
// that are applied via the existing inherited tool policy gate (inherited-tool-deny.ts).
// The deny lists are merged into the role-spawn context so role-driven subagents
// are HARD-enforced, not just advisory.
//
// Deny lists are additive — they only DENY tools, they never grant tools beyond
// what the role's tools[] allowlist already permits.

import type { RoleContract } from "./role-contract.js";

/** Filesystem tools known to write/modify files. */
const FS_WRITE_TOOLS = ["write", "edit", "apply_patch", "team_orchestrate", "task_loop", "mission_loop"] as const;

/** Filesystem tools that only read. */
const FS_READ_TOOLS = ["read", "glob", "grep"] as const;

/** All filesystem tools (read + write). */
const FS_ALL_TOOLS = [...FS_READ_TOOLS, ...FS_WRITE_TOOLS] as const;

/** Tools that execute shell commands. */
const SHELL_TOOLS = ["exec", "bash"] as const;

/**
 * Tools that require network access.
 * Includes core retrieval tools (web_search/web_fetch) and plugin-registered
 * network-capable tools (x_search, code_execution, browser).
 */
const NETWORK_TOOLS = ["web_search", "web_fetch", "x_search", "code_execution", "browser"] as const;

/**
 * Tools with unrestricted or hard-to-audit network egress. These are denied
 * under `network: "limited"` because their network behaviour cannot be scoped
 * to a safe subset. `web_search`/`web_fetch` are ALLOWED under limited because
 * they are read-only retrieval tools.
 */
const NETWORK_HIGH_RISK_TOOLS = ["x_search", "code_execution", "browser"] as const;

/**
 * Build tool deny lists derived from role permissions.
 * These are ADDITIVE on top of the role's tools[] allowlist.
 */
export function buildRolePermissionDenyList(
  role: RoleContract,
): string[] {
  const deny = new Set<string>();
  const fs = role.permissions.filesystem;

  // Filesystem mapping
  if (fs === "none") {
    // Deny ALL filesystem tools
    for (const tool of FS_ALL_TOOLS) deny.add(tool);
    for (const tool of SHELL_TOOLS) deny.add(tool);
  } else if (fs === "read") {
    // Deny write tools only
    for (const tool of FS_WRITE_TOOLS) deny.add(tool);
    // Also deny shell when filesystem is read-only (can't write output)
    for (const tool of SHELL_TOOLS) deny.add(tool);
  }
  // fs === "write" or "admin": no extra filesystem denial

  // Network mapping
  const net = role.permissions.network;
  if (net === "none") {
    // Deny ALL network-capable tools
    for (const tool of NETWORK_TOOLS) deny.add(tool);
  } else if (net === "limited") {
    // Deny high-risk network tools (unrestricted egress) but allow read-only retrieval
    for (const tool of NETWORK_HIGH_RISK_TOOLS) deny.add(tool);
  }
  // net === "full": no network denial

  // Commands: if commands allowlist is empty and fs is not write/admin,
  // deny shell tools as an additional safety measure.
  // If commands is non-empty (a command allowlist is specified), the role
  // intends to restrict shell usage — deny shell at the tool level.
  // (Command-argument-level filtering is a future enhancement requiring tool
  // layer support; currently enforcement is at tool-granularity.)
  const commands = role.permissions.commands;
  if (
    (!commands || commands.length === 0) &&
    (fs === "none" || fs === "read")
  ) {
    for (const tool of SHELL_TOOLS) deny.add(tool);
  } else if (commands && commands.length > 0 && fs !== "write" && fs !== "admin") {
    // A non-empty command allowlist signals intent to restrict shell access.
    // Deny shell tools unless the role has write/admin filesystem (which
    // already grants broad execution capability).
    for (const tool of SHELL_TOOLS) deny.add(tool);
  }

  return [...deny];
}

/**
 * Build inherited tool deny entries for role-spawn context.
 * Merges the role's permission-derived deny list with any pre-existing
 * deny list from the caller context.
 */
export function buildRolePermissionDenyPatches(
  role: RoleContract,
  existingDeny?: string[],
): { inheritedToolDenylist?: string[]; inheritedToolAllow?: string[] } {
  const permissionDeny = buildRolePermissionDenyList(role);

  // Build a tool allowlist that combines role.tools (must-have) with
  // permission-derived deny (must-not-have). Deny takes precedence.
  const mergedDeny = [
    ...new Set([
      ...(existingDeny ?? []),
      ...permissionDeny,
    ]),
  ];

  return (mergedDeny.length > 0 ? { inheritedToolDenylist: mergedDeny } : {});
}

import { resolve, normalize, isAbsolute, relative } from "node:path";

export type RolePathAccessMode = "read" | "write";

function normalizePathKey(value: string): string {
  return normalize(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isUnderRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Resolve a role path pattern against a workspace root.
 * Absolute patterns stay absolute; relative patterns are workspace-relative.
 */
export function resolveRolePathPattern(pattern: string, workspaceRoot?: string): string {
  const trimmed = pattern.trim();
  if (!trimmed) return "";
  if (isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return normalizePathKey(resolve(trimmed));
  }
  const root = workspaceRoot ? resolve(workspaceRoot) : process.cwd();
  return normalizePathKey(resolve(root, trimmed));
}

/**
 * Hard path gate for role permissions (P2-003 / F-AUTH-002).
 * - filesystem none => deny all path access
 * - filesystem read => write denied; readPaths (if set) restrict reads
 * - filesystem write/admin => writePaths (if set) restrict writes; readPaths restrict reads when set
 * Empty path lists mean "no extra restriction beyond filesystem mode".
 */
export function isRolePathAllowed(
  targetPath: string,
  role: RoleContract,
  mode: RolePathAccessMode,
  workspaceRoot?: string,
): boolean {
  const fsMode = role.permissions.filesystem;
  if (fsMode === "none") return false;
  if (mode === "write" && (fsMode === "read")) return false;

  const resolvedTarget = resolveRolePathPattern(targetPath, workspaceRoot);
  if (!resolvedTarget) return false;

  const readPaths = role.permissions.readPaths ?? [];
  const writePaths = role.permissions.writePaths ?? [];

  if (mode === "read") {
    if (readPaths.length === 0) return true;
    return readPaths.some((pattern) => {
      const root = resolveRolePathPattern(pattern, workspaceRoot);
      return root ? isUnderRoot(resolvedTarget, root) || resolvedTarget === root : false;
    });
  }

  // write
  if (writePaths.length === 0) {
    // If only readPaths are declared, writes outside those roots are denied when filesystem is write
    // but writePaths empty historically meant unrestricted within fs mode. Keep unrestricted when empty.
    return true;
  }
  return writePaths.some((pattern) => {
    const root = resolveRolePathPattern(pattern, workspaceRoot);
    return root ? isUnderRoot(resolvedTarget, root) || resolvedTarget === root : false;
  });
}

export function decideRolePathAccess(
  targetPath: string,
  role: RoleContract,
  mode: RolePathAccessMode,
  workspaceRoot?: string,
): { allowed: boolean; reason?: string } {
  const allowed = isRolePathAllowed(targetPath, role, mode, workspaceRoot);
  if (allowed) return { allowed: true };
  return {
    allowed: false,
    reason: `Role ${role.name} denies ${mode} for path under filesystem=${role.permissions.filesystem}`,
  };
}

const FS_RANK: Record<string, number> = { none: 0, read: 1, write: 2, admin: 3 };
const NET_RANK: Record<string, number> = { none: 0, limited: 1, full: 2 };

export function clampFilesystemAccess(
  child: RoleContract["permissions"]["filesystem"],
  parent?: RoleContract["permissions"]["filesystem"],
): RoleContract["permissions"]["filesystem"] {
  if (!parent) return child;
  return (FS_RANK[child] <= FS_RANK[parent] ? child : parent) as RoleContract["permissions"]["filesystem"];
}

export function clampNetworkAccess(
  child: RoleContract["permissions"]["network"],
  parent?: RoleContract["permissions"]["network"],
): RoleContract["permissions"]["network"] {
  if (!parent) return child;
  return (NET_RANK[child] <= NET_RANK[parent] ? child : parent) as RoleContract["permissions"]["network"];
}

/**
 * Intersect child path allowlist with parent. Parent empty => unrestricted (return child).
 * Child empty with parent restricted => inherit parent.
 */
export function clampPathAllowlist(
  childPaths: string[] | undefined,
  parentPaths: string[] | undefined,
): string[] | undefined {
  const parent = (parentPaths ?? []).map((p) => p.trim()).filter(Boolean);
  const child = (childPaths ?? []).map((p) => p.trim()).filter(Boolean);
  if (parent.length === 0) return child.length > 0 ? child : undefined;
  if (child.length === 0) return parent;
  const parentResolved = parent.map((p) => resolveRolePathPattern(p));
  return child.filter((entry) => {
    const resolved = resolveRolePathPattern(entry);
    return parentResolved.some((root) => isUnderRoot(resolved, root) || resolved === root);
  });
}

/** Child tool allowlist cannot exceed parent allowlist when parent is set. */
export function clampToolAllowlist(
  childTools: string[] | undefined,
  parentTools: string[] | undefined,
): string[] | undefined {
  if (!parentTools || parentTools.length === 0) return childTools;
  if (!childTools || childTools.length === 0) return [...parentTools];
  const parentSet = new Set(parentTools);
  return childTools.filter((tool) => parentSet.has(tool));
}

export function clampRolePermissionsToParent(
  child: RoleContract,
  parent?: Pick<RoleContract, "permissions" | "tools"> | null,
): RoleContract {
  if (!parent) return child;
  const filesystem = clampFilesystemAccess(child.permissions.filesystem, parent.permissions.filesystem);
  const network = clampNetworkAccess(child.permissions.network, parent.permissions.network);
  const readPaths = clampPathAllowlist(child.permissions.readPaths, parent.permissions.readPaths);
  const writePaths = clampPathAllowlist(child.permissions.writePaths, parent.permissions.writePaths);
  const tools = clampToolAllowlist(child.tools, parent.tools) ?? child.tools;
  return {
    ...child,
    tools,
    permissions: {
      ...child.permissions,
      filesystem,
      network,
      ...(readPaths && readPaths.length > 0 ? { readPaths } : {}),
      ...(writePaths && writePaths.length > 0 ? { writePaths } : {}),
    },
  };
}
