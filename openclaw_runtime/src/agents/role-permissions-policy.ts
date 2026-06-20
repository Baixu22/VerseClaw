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
const FS_WRITE_TOOLS = ["write", "edit", "apply_patch", "team_orchestrate", "task_loop"] as const;

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

  return {
    ...(mergedDeny.length > 0 ? { inheritedToolDenylist: mergedDeny } : {}),
  };
}
