import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
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
  journal?: boolean;
  sessionId?: string;
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
    sessionId: params.sessionId,
    config:
      fs || applyPatch
        ? ({
            tools: { ...(fs ? { fs } : {}), ...(applyPatch ? { exec: { applyPatch } } : {}) },
          } as never)
        : undefined,
    writeJournalEnabled: params.journal ?? false,
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
  it.each(["write", "edit"] as const)("does not journal rejected %s pre-images through paths or aliases", async (name) => {
    const provenances = [
      createTrustedProvenance({ sourceKind: "user-direct", sourceId: "journal-operator", receivedAt: "2026-11-04T00:00:00Z" }),
      createExternalProvenance({ sourceKind: "web", sourceId: "journal-web", receivedAt: "2026-11-04T00:00:00Z" }),
      undefined,
    ];
    for (const contentProvenance of provenances) {
      for (const form of ["absolute", "junction", "hardlink"]) {
        const { workspaceDir, outsideFile } = await makeWorkspace();
        const marker = "private-generated-preimage\n";
        await writeFile(outsideFile, marker);
        let target = outsideFile;
        if (form === "junction") {
          const alias = path.join(workspaceDir, "alias");
          await symlink(path.dirname(outsideFile), alias, process.platform === "win32" ? "junction" : "dir");
          target = path.join(alias, path.basename(outsideFile));
        } else if (form === "hardlink") {
          target = path.join(workspaceDir, "alias.txt");
          await link(outsideFile, target);
        }
        const tools = createTools({ workspaceDir, fsWorkspaceOnly: true, contentProvenance, journal: true, sessionId: "journal-boundary" });
        const args = name === "write" ? { path: target, content: "denied" } : { path: target, edits: [{ oldText: marker, newText: "denied" }] };
        await expect(requireTool(tools, name).execute("denied", args)).rejects.toThrow();
        expect(await readFile(outsideFile, "utf8")).toBe(marker);
        const snapshots = await readdir(path.join(workspaceDir, ".openclaw", "journal", "journal-boundary")).catch((error) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
        expect(snapshots).toEqual([]);
      }
    }
  });

  it("journals allowed writes and edits and restores their pre-images", async () => {
    const { workspaceDir } = await makeWorkspace();
    const target = path.join(workspaceDir, "inside.txt");
    await writeFile(target, "before\n");
    const tools = createTools({ workspaceDir, fsWorkspaceOnly: true, journal: true, sessionId: "allowed-journal" });
    await requireTool(tools, "write").execute("write", { path: "inside.txt", content: "written\n" });
    await requireTool(tools, "edit").execute("edit", { path: target, edits: [{ oldText: "written", newText: "edited" }] });
    expect(await readFile(target, "utf8")).toBe("edited\n");
    const result = await requireTool(tools, "undo_write").execute("undo", { steps: 2 });
    expect(result.details).toMatchObject({ ok: true });
    expect(await readFile(target, "utf8")).toBe("before\n");
  });

  it.each(["create", "modify"] as const)("refuses %s undo after a parent is replaced by an external junction", async (operation) => {
    const { workspaceDir, outsideFile } = await makeWorkspace();
    const folder = path.join(workspaceDir, "sub");
    const local = path.join(folder, path.basename(outsideFile));
    await mkdir(folder);
    if (operation === "modify") await writeFile(local, "local-before\n");
    const tools = createTools({ workspaceDir, fsWorkspaceOnly: true, journal: true, sessionId: "undo-junction" });
    await requireTool(tools, "write").execute("local", { path: local, content: "local-after\n" });
    await rename(folder, path.join(workspaceDir, "original-sub"));
    await symlink(path.dirname(outsideFile), folder, process.platform === "win32" ? "junction" : "dir");
    const result = await requireTool(tools, "undo_write").execute("undo", { steps: 1 });
    expect(result.details).toMatchObject({ ok: false, restored: [], remainingEntries: 1 });
    expect(await readFile(outsideFile, "utf8")).toBe("original\n");
    expect((await readdir(path.join(workspaceDir, ".openclaw/journal/undo-junction"))).some((p) => p.endsWith(".pre"))).toBe(true);
  });

  it("refuses undo through a hardlinked target and retains its snapshot", async () => {
    const { workspaceDir, outsideFile } = await makeWorkspace();
    const local = path.join(workspaceDir, "local.txt");
    await writeFile(local, "before\n");
    const tools = createTools({ workspaceDir, fsWorkspaceOnly: true, journal: true, sessionId: "undo-hardlink" });
    await requireTool(tools, "write").execute("local", { path: local, content: "after\n" });
    await rm(local);
    await link(outsideFile, local);
    const result = await requireTool(tools, "undo_write").execute("undo", { steps: 1 });
    expect(result.details).toMatchObject({ ok: false, restored: [], remainingEntries: 1 });
    expect(await readFile(outsideFile, "utf8")).toBe("original\n");
  });

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

// S03: explicit path-escape matrix for the workspace external-write boundary.
// Every form must be denied for external provenance with the outside file left
// byte-for-byte unchanged. (UNC / device-namespace forms are recorded as a
// residual in docs/dev/harness-gap-closure/s03-external-write-boundary.md rather
// than asserted here, because they cannot be exercised deterministically.)
describe("S03 workspace external-write path-escape matrix", () => {
  const escapeForms: Array<[string, (input: { workspaceDir: string; outsideFile: string }) => string]> = [
    ["relative-parent-escape", ({ workspaceDir }) => path.join(workspaceDir, "..", "outside.txt")],
    ["absolute-outside", ({ outsideFile }) => outsideFile],
  ];
  if (process.platform === "win32") {
    escapeForms.push(["win32-case-variant", ({ outsideFile }) => outsideFile.toUpperCase()]);
  }

  it.each(escapeForms)(
    "denies %s for external provenance without modifying the target",
    async (_label, resolvePath) => {
      const { workspaceDir, outsideFile } = await makeWorkspace();
      const tools = createTools({
        workspaceDir,
        contentProvenance: createExternalProvenance({
          sourceKind: "web",
          sourceId: "web:s03-escape-matrix",
          receivedAt: "2026-08-21T00:00:00.000Z",
        }),
      });
      await expect(
        requireTool(tools, "write").execute("write-escape", {
          path: resolvePath({ workspaceDir, outsideFile }),
          content: "blocked\n",
        }),
      ).rejects.toThrow(/external or unknown provenance/);
      expect(await readFile(outsideFile, "utf8")).toBe("original\n");
    },
  );

  it("keeps a trusted operator external write authoritative (content preserved exactly)", async () => {
    const { workspaceDir, outsideFile } = await makeWorkspace();
    const tools = createTools({
      workspaceDir,
      contentProvenance: createTrustedProvenance({
        sourceKind: "user-direct",
        sourceId: "operator:s03-legal-external",
        receivedAt: "2026-08-21T00:00:00.000Z",
      }),
    });
    await requireTool(tools, "write").execute("write-legal", {
      path: outsideFile,
      content: "operator-written\n",
    });
    expect(await readFile(outsideFile, "utf8")).toBe("operator-written\n");
  });
});
