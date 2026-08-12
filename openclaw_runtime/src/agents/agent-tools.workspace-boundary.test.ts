import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenClawCodingTools } from "./agent-tools.js";

const stateRoots: string[] = [];

afterEach(async () => {
  for (const root of stateRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeWorkspace() {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "clawx-workspace-policy-"));
  const workspaceDir = path.join(stateRoot, "workspace");
  const outsideFile = path.join(stateRoot, "outside.txt");
  await mkdir(workspaceDir);
  await writeFile(outsideFile, "original\n");
  stateRoots.push(stateRoot);
  return { workspaceDir, outsideFile };
}

function createTools(params: {
  workspaceDir: string;
  fsWorkspaceOnly?: boolean;
  applyPatchWorkspaceOnly?: boolean;
}) {
  const fs =
    params.fsWorkspaceOnly === undefined ? undefined : { workspaceOnly: params.fsWorkspaceOnly };
  const applyPatch =
    params.applyPatchWorkspaceOnly === undefined
      ? undefined
      : { workspaceOnly: params.applyPatchWorkspaceOnly };
  return createOpenClawCodingTools({
    cwd: params.workspaceDir,
    workspaceDir: params.workspaceDir,
    config:
      fs || applyPatch
        ? ({
            tools: { ...(fs ? { fs } : {}), ...(applyPatch ? { exec: { applyPatch } } : {}) },
          } as never)
        : undefined,
    writeJournalEnabled: false,
    toolConstructionPlan: {
      includeBaseCodingTools: true,
      includeShellTools: true,
      includeChannelTools: false,
      includeOpenClawTools: false,
      includePluginTools: false,
    },
  });
}

function requireTool(tools: ReturnType<typeof createTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`${name} tool missing`);
  }
  return tool;
}

function updatePatch(filePath: string, before: string, after: string): string {
  return [
    "*** Begin Patch",
    `*** Update File: ${filePath.replace(/\\/g, "/")}`,
    "@@",
    `-${before}`,
    `+${after}`,
    "*** End Patch",
  ].join("\n");
}

describe("coding mutation workspace boundary", () => {
  it("allows write, edit, and apply_patch outside the workspace by default", async () => {
    const { workspaceDir, outsideFile } = await makeWorkspace();
    const tools = createTools({ workspaceDir });

    await requireTool(tools, "write").execute("write-outside", {
      path: outsideFile,
      content: "written\n",
    });
    await requireTool(tools, "edit").execute("edit-outside", {
      path: outsideFile,
      edits: [{ oldText: "written", newText: "edited" }],
    });
    await requireTool(tools, "apply_patch").execute("patch-outside", {
      input: updatePatch(outsideFile, "edited", "patched"),
    });

    expect(await readFile(outsideFile, "utf8")).toBe("patched\n");
  });

  it("keeps the fs workspace-only policy authoritative for every mutation tool", async () => {
    const { workspaceDir, outsideFile } = await makeWorkspace();
    const tools = createTools({
      workspaceDir,
      fsWorkspaceOnly: true,
      applyPatchWorkspaceOnly: false,
    });

    await expect(
      requireTool(tools, "write").execute("write-outside", {
        path: outsideFile,
        content: "blocked\n",
      }),
    ).rejects.toThrowError(/escapes (?:workspace|sandbox) root/i);
    await expect(
      requireTool(tools, "edit").execute("edit-outside", {
        path: outsideFile,
        edits: [{ oldText: "original", newText: "blocked" }],
      }),
    ).rejects.toThrowError(/escapes (?:workspace|sandbox) root/i);
    await expect(
      requireTool(tools, "apply_patch").execute("patch-outside", {
        input: updatePatch(outsideFile, "original", "blocked"),
      }),
    ).rejects.toThrowError(/escapes (?:workspace|sandbox) root/i);
    expect(await readFile(outsideFile, "utf8")).toBe("original\n");
  });

  it("supports an explicit apply_patch-only workspace restriction", async () => {
    const { workspaceDir, outsideFile } = await makeWorkspace();
    const tools = createTools({ workspaceDir, applyPatchWorkspaceOnly: true });

    await requireTool(tools, "write").execute("write-outside", {
      path: outsideFile,
      content: "written\n",
    });
    await expect(
      requireTool(tools, "apply_patch").execute("patch-outside", {
        input: updatePatch(outsideFile, "written", "blocked"),
      }),
    ).rejects.toThrowError(/escapes (?:workspace|sandbox) root/i);
    expect(await readFile(outsideFile, "utf8")).toBe("written\n");
  });
});
