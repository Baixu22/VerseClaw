import { describe, expect, it } from "vitest";
import {
  appendReadOnlyWorkspaceSkillMountArgs,
  appendWorkspaceMountArgs,
} from "./workspace-mounts.js";

describe("appendWorkspaceMountArgs", () => {
  it("emits Windows bind sources unchanged without a translator", () => {
    const args: string[] = [];
    appendWorkspaceMountArgs({
      args,
      workspaceDir: "C:\\Users\\27933\\.openclaw\\workspace",
      agentWorkspaceDir: "C:\\Users\\27933\\.openclaw",
      workdir: "/workspace",
      workspaceAccess: "rw",
      readOnlyWorkspaceSkillMounts: [],
      includeReadOnlyWorkspaceSkillMounts: false,
    });
    expect(args).toContain("-v");
    expect(args).toContain("C:\\Users\\27933\\.openclaw\\workspace:/workspace:z");
  });

  it("applies the translator to the workspace and agent workspace mounts", () => {
    const args: string[] = [];
    appendWorkspaceMountArgs({
      args,
      workspaceDir: "C:\\repo",
      agentWorkspaceDir: "C:\\Users\\u\\.openclaw",
      workdir: "/workspace",
      workspaceAccess: "ro",
      readOnlyWorkspaceSkillMounts: [],
      includeReadOnlyWorkspaceSkillMounts: false,
      translateHostPath: (hostPath) =>
        hostPath.startsWith("C:\\") ? `/mnt/c/${hostPath.slice(3).replaceAll("\\", "/")}` : hostPath,
    });
    expect(args).toContain("/mnt/c/repo:/workspace:ro,z");
    expect(args).toContain("/mnt/c/Users/u/.openclaw:/agent:ro,z");
  });

  it("translates read-only skill mount host paths", () => {
    const args: string[] = [];
    appendReadOnlyWorkspaceSkillMountArgs({
      args,
      readOnlyWorkspaceSkillMounts: [
        { hostPath: "C:\\Users\\u\\.openclaw\\skills", containerPath: "/workspace/skills" },
      ],
      translateHostPath: (hostPath) =>
        hostPath.startsWith("C:\\") ? `/mnt/c/${hostPath.slice(3).replaceAll("\\", "/")}` : hostPath,
    });
    expect(args).toContain("/mnt/c/Users/u/.openclaw/skills:/workspace/skills:ro,z");
  });
});
