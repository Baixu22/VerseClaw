import { describe, expect, it } from "vitest";
import {
  BUILT_IN_ROLE_NAMES,
  BUILT_IN_ROLE_CONTRACTS,
  getBuiltInRoleContract,
  normalizeRoleContract,
} from "../../openclaw_runtime/src/agents/role-contract";
import {
  buildRolePermissionDenyList,
  clampRolePermissionsToParent,
  clampToolAllowlist,
  decideRolePathAccess,
  isRolePathAllowed,
} from "../../openclaw_runtime/src/agents/role-permissions-policy";
import { buildRoleSpawnContext } from "../../openclaw_runtime/src/agents/role-spawn";

describe("P2-003 role path hard enforcement", () => {
  it("A3: Electron/runtime built-in role names share one registry", () => {
    const runtimeNames = [...BUILT_IN_ROLE_NAMES].sort();
    const fromContracts = BUILT_IN_ROLE_CONTRACTS.map((role) => role.name).sort();
    expect(runtimeNames).toEqual(fromContracts);
    // Drift roles from the old Electron-only set must not remain authoritative.
    expect(runtimeNames).toContain("skeptic");
    expect(runtimeNames).toContain("security-reviewer");
    expect(runtimeNames).toContain("docs-writer");
    expect(runtimeNames).not.toContain("researcher");
    expect(runtimeNames).not.toContain("documenter");
    expect(runtimeNames).not.toContain("devops");
  });

  it("A1: read/write path matrix is hard-enforced", () => {
    const role = normalizeRoleContract({
      name: "path-limited",
      display_name: "Path Limited",
      description: "test",
      role_prompt: "Stay inside allowed paths for this conformance matrix.",
      tools: ["read", "write"],
      permissions: {
        filesystem: "write",
        network: "none",
        commands: [],
        readPaths: ["src"],
        writePaths: ["src/allowed"],
      },
    });

    expect(isRolePathAllowed("src/index.ts", role, "read", "C:/project")).toBe(true);
    expect(isRolePathAllowed("docs/readme.md", role, "read", "C:/project")).toBe(false);
    expect(isRolePathAllowed("src/allowed/a.ts", role, "write", "C:/project")).toBe(true);
    expect(isRolePathAllowed("src/other/a.ts", role, "write", "C:/project")).toBe(false);
    expect(decideRolePathAccess("src/other/a.ts", role, "write", "C:/project").allowed).toBe(false);

    const readOnly = normalizeRoleContract({
      name: "reader",
      display_name: "Reader",
      description: "test",
      role_prompt: "Read-only role for path matrix.",
      tools: ["read"],
      permissions: { filesystem: "read", network: "none", commands: [], readPaths: ["src"] },
    });
    expect(isRolePathAllowed("src/a.ts", readOnly, "write", "C:/project")).toBe(false);
    expect(buildRolePermissionDenyList(readOnly)).toEqual(
      expect.arrayContaining(["write", "edit", "apply_patch", "exec", "bash"]),
    );
  });

  it("A2: child agent privileges cannot exceed parent", () => {
    const parent = normalizeRoleContract({
      name: "parent",
      display_name: "Parent",
      description: "test",
      role_prompt: "Parent role with restricted tools and paths.",
      tools: ["read", "write"],
      permissions: {
        filesystem: "write",
        network: "limited",
        commands: [],
        readPaths: ["src"],
        writePaths: ["src"],
      },
    });
    const childEscalating = normalizeRoleContract({
      name: "child",
      display_name: "Child",
      description: "test",
      role_prompt: "Child attempts privilege escalation beyond parent.",
      tools: ["read", "write", "exec", "bash", "web_search"],
      permissions: {
        filesystem: "admin",
        network: "full",
        commands: [],
        readPaths: ["src", "secrets"],
        writePaths: ["src", "secrets"],
      },
    });

    const clamped = clampRolePermissionsToParent(childEscalating, parent);
    expect(clamped.permissions.filesystem).toBe("write");
    expect(clamped.permissions.network).toBe("limited");
    expect(clamped.tools).toEqual(["read", "write"]);
    expect(clamped.permissions.readPaths?.some((p) => p.includes("secrets"))).toBeFalsy();
    expect(clamped.permissions.writePaths?.some((p) => p.includes("secrets"))).toBeFalsy();

    const ctx = buildRoleSpawnContext(childEscalating, {
      inheritedToolAllowlist: ["read", "write"],
      parentRole: parent,
    });
    expect(ctx.inheritedToolAllowlist).toEqual(["read", "write"]);
    expect(ctx.inheritedToolDenylist ?? []).toEqual(
      expect.arrayContaining(["x_search", "code_execution", "browser"]),
    );
    expect(ctx.inheritedToolDenylist ?? []).not.toContain("web_search");
  });

  it("clamps tool allowlists under parent inheritance", () => {
    expect(clampToolAllowlist(["read", "exec"], ["read", "write"])).toEqual(["read"]);
    expect(clampToolAllowlist(undefined, ["read"])).toEqual(["read"]);
    expect(getBuiltInRoleContract("implementer")?.name).toBe("implementer");
  });
});
