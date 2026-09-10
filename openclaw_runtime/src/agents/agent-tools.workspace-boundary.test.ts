import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createExternalProvenance,
  createTrustedProvenance,
  deriveProvenance,
} from "../../../shared/security/content-provenance.js";
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
  cwd?: string;
  fsWorkspaceOnly?: boolean;
  applyPatchWorkspaceOnly?: boolean;
  contentProvenance?: unknown;
}) {
  const fs =
    params.fsWorkspaceOnly === undefined ? undefined : { workspaceOnly: params.fsWorkspaceOnly };
  const applyPatch =
    params.applyPatchWorkspaceOnly === undefined
      ? undefined
      : { workspaceOnly: params.applyPatchWorkspaceOnly };
  return createOpenClawCodingTools({
    cwd: params.cwd ?? params.workspaceDir,
    workspaceDir: params.workspaceDir,
    contentProvenance: params.contentProvenance,
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
  it("allows trusted operator write, edit, and apply_patch outside the workspace", async () => {
    const { workspaceDir, outsideFile } = await makeWorkspace();
    const tools = createTools({
      workspaceDir,
      contentProvenance: createTrustedProvenance({
        sourceKind: "user-direct",
        sourceId: "operator:workspace-boundary",
        receivedAt: "2026-08-21T00:00:00.000Z",
      }),
    });

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

  it.each(["write", "edit", "apply_patch"] as const)(
    "blocks external, derived, invalid, and missing provenance before %s mutates outside the workspace",
    async (toolName) => {
      const provenanceCases = [
        [
          "external",
          createExternalProvenance({
            sourceKind: "web",
            sourceId: "web:workspace-boundary",
            receivedAt: "2026-08-21T00:00:00.000Z",
          }),
        ],
        [
          "derived",
          deriveProvenance({
            sourceKind: "tool-result",
            sourceId: "tool-result:workspace-boundary",
            receivedAt: "2026-08-21T00:00:00.000Z",
            parents: [
              createExternalProvenance({
                sourceKind: "web",
                sourceId: "web:workspace-boundary-parent",
                receivedAt: "2026-08-21T00:00:00.000Z",
              }),
            ],
          }),
        ],
        ["invalid", { trustLevel: "trusted" }],
        ["missing", undefined],
      ] as const;
      for (const [_provenanceLabel, contentProvenance] of provenanceCases) {
        const { workspaceDir, outsideFile } = await makeWorkspace();
        const tools = createTools({
          workspaceDir,
          contentProvenance,
        });
        const params =
          toolName === "write"
            ? { path: outsideFile, content: "blocked\n" }
            : toolName === "edit"
              ? { path: outsideFile, edits: [{ oldText: "original", newText: "blocked" }] }
              : { input: updatePatch(outsideFile, "original", "blocked") };

        await expect(
          requireTool(tools, toolName).execute(`${toolName}-outside`, params),
        ).rejects.toThrow(/external or unknown provenance/);
        expect(await readFile(outsideFile, "utf8")).toBe("original\n");
      }
    },
  );

  it("keeps in-workspace writes usable for external and missing provenance", async () => {
    for (const contentProvenance of [
      createExternalProvenance({
        sourceKind: "channel",
        sourceId: "channel:workspace-write",
        receivedAt: "2026-08-21T00:00:00.000Z",
      }),
      undefined,
    ]) {
      const { workspaceDir } = await makeWorkspace();
      const insideFile = path.join(workspaceDir, "inside.txt");
      const tools = createTools({ workspaceDir, contentProvenance });
      await requireTool(tools, "write").execute("write-inside", {
        path: insideFile,
        content: "inside\n",
      });
      expect(await readFile(insideFile, "utf8")).toBe("inside\n");
    }
  });

  it("treats a sibling of cwd as in-workspace when workspaceDir is broader", async () => {
    const { workspaceDir } = await makeWorkspace();
    const nestedCwd = path.join(workspaceDir, "nested");
    await mkdir(nestedCwd);
    const siblingFile = path.join(workspaceDir, "sibling.txt");
    const tools = createTools({
      workspaceDir,
      cwd: nestedCwd,
      contentProvenance: createExternalProvenance({
        sourceKind: "web",
        sourceId: "web:workspace-subdirectory",
        receivedAt: "2026-08-21T00:00:00.000Z",
      }),
    });

    await requireTool(tools, "write").execute("write-workspace-sibling", {
      path: "../sibling.txt",
      content: "inside\n",
    });
    expect(await readFile(siblingFile, "utf8")).toBe("inside\n");
  });

  it("uses cwd as the fallback workspace when workspaceDir is omitted", async () => {
    const { workspaceDir, outsideFile } = await makeWorkspace();
    const tools = createOpenClawCodingTools({
      cwd: workspaceDir,
      contentProvenance: createExternalProvenance({
        sourceKind: "channel",
        sourceId: "channel:cwd-fallback",
        receivedAt: "2026-08-21T00:00:00.000Z",
      }),
      toolConstructionPlan: {
        includeBaseCodingTools: true,
        includeShellTools: true,
        includeChannelTools: false,
        includeOpenClawTools: false,
        includePluginTools: false,
      },
      writeJournalEnabled: false,
    });
    const write = requireTool(tools, "write");

    await write.execute("write-cwd-inside", {
      path: "inside-cwd.txt",
      content: "inside\n",
    });
    await expect(
      write.execute("write-cwd-outside", {
        path: outsideFile,
        content: "blocked\n",
      }),
    ).rejects.toThrow(/external or unknown provenance/);
    expect(await readFile(path.join(workspaceDir, "inside-cwd.txt"), "utf8")).toBe("inside\n");
    expect(await readFile(outsideFile, "utf8")).toBe("original\n");
  });

  it("fails missing provenance closed for an external target", async () => {
    const { workspaceDir, outsideFile } = await makeWorkspace();
    const tools = createTools({ workspaceDir });
    await expect(
      requireTool(tools, "write").execute("write-outside-missing", {
        path: outsideFile,
        content: "blocked\n",
      }),
    ).rejects.toThrow(/external or unknown provenance/);
    expect(await readFile(outsideFile, "utf8")).toBe("original\n");
  });

  it("preserves the existing malformed apply_patch validation error", async () => {
    const { workspaceDir } = await makeWorkspace();
    const tools = createTools({ workspaceDir });
    await expect(
      requireTool(tools, "apply_patch").execute("malformed-patch", {
        input: "*** Begin Patch\n*** End Patch",
      }),
    ).rejects.toThrow("No files were modified.");
  });

  it("denies workspace paths whose existing alias resolves outside the workspace", async () => {
    const { workspaceDir, outsideFile } = await makeWorkspace();
    const aliasDir = path.join(workspaceDir, "external-alias");
    await symlink(
      path.dirname(outsideFile),
      aliasDir,
      process.platform === "win32" ? "junction" : "dir",
    );
    const tools = createTools({
      workspaceDir,
      contentProvenance: createExternalProvenance({
        sourceKind: "web",
        sourceId: "web:workspace-alias",
        receivedAt: "2026-08-21T00:00:00.000Z",
      }),
    });

    await expect(
      requireTool(tools, "write").execute("write-alias", {
        path: path.join(aliasDir, path.basename(outsideFile)),
        content: "blocked\n",
      }),
    ).rejects.toThrow(/external or unknown provenance/);
    expect(await readFile(outsideFile, "utf8")).toBe("original\n");
  });

  it("fails closed for an in-workspace hardlink alias", async () => {
    const { workspaceDir, outsideFile } = await makeWorkspace();
    const hardlinkPath = path.join(workspaceDir, "outside-hardlink.txt");
    await link(outsideFile, hardlinkPath);
    const tools = createTools({
      workspaceDir,
      contentProvenance: createExternalProvenance({
        sourceKind: "channel",
        sourceId: "channel:workspace-hardlink",
        receivedAt: "2026-08-21T00:00:00.000Z",
      }),
    });

    await expect(
      requireTool(tools, "write").execute("write-hardlink", {
        path: hardlinkPath,
        content: "blocked\n",
      }),
    ).rejects.toThrow(/external or unknown provenance/);
    expect(await readFile(outsideFile, "utf8")).toBe("original\n");
  });

  it("keeps the fs workspace-only policy authoritative for every mutation tool", async () => {
    const { workspaceDir, outsideFile } = await makeWorkspace();
    const tools = createTools({
      workspaceDir,
      fsWorkspaceOnly: true,
      applyPatchWorkspaceOnly: false,
      contentProvenance: createTrustedProvenance({
        sourceKind: "user-direct",
        sourceId: "operator:workspace-only",
        receivedAt: "2026-08-21T00:00:00.000Z",
      }),
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
    const tools = createTools({
      workspaceDir,
      applyPatchWorkspaceOnly: true,
      contentProvenance: createTrustedProvenance({
        sourceKind: "user-direct",
        sourceId: "operator:apply-patch-workspace-only",
        receivedAt: "2026-08-21T00:00:00.000Z",
      }),
    });

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
