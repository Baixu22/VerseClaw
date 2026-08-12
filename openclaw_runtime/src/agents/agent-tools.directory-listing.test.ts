import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenClawCodingTools } from "./agent-tools.js";
import { createAgentToolsSandboxContext } from "./test-helpers/agent-tools-sandbox-context.js";
import { createHostSandboxFsBridge } from "./test-helpers/host-sandbox-fs-bridge.js";
import {
  CORE_TOOL_GROUPS,
  listCoreToolSections,
  resolveCoreToolProfilePolicy,
} from "./tool-catalog.js";

const stateRoots: string[] = [];

afterEach(async () => {
  for (const root of stateRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeWorkspace() {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "clawx-agent-ls-"));
  const workspaceDir = path.join(stateRoot, "workspace");
  await mkdir(workspaceDir);
  stateRoots.push(stateRoot);
  return { stateRoot, workspaceDir };
}

function createBaseTools(params: {
  workspaceDir: string;
  sandbox?: ReturnType<typeof createAgentToolsSandboxContext>;
}) {
  return createOpenClawCodingTools({
    cwd: params.workspaceDir,
    workspaceDir: params.workspaceDir,
    sandbox: params.sandbox,
    config: {
      tools: {
        profile: "coding",
        fs: { workspaceOnly: true },
      },
    } as never,
    toolConstructionPlan: {
      includeBaseCodingTools: true,
      includeShellTools: false,
      includeChannelTools: false,
      includeOpenClawTools: false,
      includePluginTools: false,
    },
  });
}

function requireTool(tools: ReturnType<typeof createBaseTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`${name} tool missing`);
  }
  return tool;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((entry) => entry.type === "text")?.text;
  if (text === undefined) {
    throw new Error("expected text tool output");
  }
  return text;
}

describe("production directory-listing tool surface", () => {
  it("exposes ls and lists workspace entries in stable order", async () => {
    const { workspaceDir } = await makeWorkspace();
    await mkdir(path.join(workspaceDir, "alpha"));
    await writeFile(path.join(workspaceDir, "middle.txt"), "middle\n");
    await mkdir(path.join(workspaceDir, "zeta"));

    const tools = createBaseTools({ workspaceDir });
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("ls");
    expect(names.indexOf("read")).toBeLessThan(names.indexOf("ls"));
    expect(names.indexOf("ls")).toBeLessThan(names.indexOf("edit"));

    const result = await requireTool(tools, "ls").execute("ls-call", { path: "." });
    expect(textOf(result)).toBe("alpha/\nmiddle.txt\nzeta/");
  });

  it("keeps ls in a read-only sandbox and reports directories through read", async () => {
    const { workspaceDir } = await makeWorkspace();
    await mkdir(path.join(workspaceDir, "folder"));
    await writeFile(path.join(workspaceDir, "note.txt"), "note\n");
    const sandbox = createAgentToolsSandboxContext({
      workspaceDir,
      workspaceAccess: "ro",
      fsBridge: createHostSandboxFsBridge(workspaceDir),
      tools: { allow: ["read", "ls"], deny: [] },
    });

    const tools = createBaseTools({ workspaceDir, sandbox });
    expect(tools.map((tool) => tool.name)).toEqual(["read", "ls"]);
    const listing = await requireTool(tools, "ls").execute("ls-sandbox", { path: "." });
    expect(textOf(listing)).toBe("folder/\nnote.txt");
    await expect(
      requireTool(tools, "read").execute("read-directory", { path: "folder" }),
    ).rejects.toThrowError(/Use the ls tool to list directory contents/);
  });

  it("rejects directory listings outside a workspace-only root", async () => {
    const { stateRoot, workspaceDir } = await makeWorkspace();
    await mkdir(path.join(stateRoot, "outside"));
    const ls = requireTool(createBaseTools({ workspaceDir }), "ls");
    await expect(ls.execute("ls-escape", { path: "../outside" })).rejects.toThrowError(
      /outside workspace root|escapes (?:workspace|sandbox) root/i,
    );
  });
});

describe("directory-listing catalog registration", () => {
  it("registers ls in Files, group:fs, and the coding profile", () => {
    const files = listCoreToolSections().find((section) => section.id === "fs");
    expect(files?.tools.some((tool) => tool.id === "ls")).toBe(true);
    expect(CORE_TOOL_GROUPS["group:fs"]).toContain("ls");
    expect(resolveCoreToolProfilePolicy("coding")?.allow).toContain("ls");
  });
});
