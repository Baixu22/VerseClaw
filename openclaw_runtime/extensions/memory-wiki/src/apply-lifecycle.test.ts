import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMemoryWikiMutation,
  normalizeMemoryWikiMutationInput,
} from "./apply.js";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import { resolveMemoryWikiConfig, getMemoryWikiPage } from "../runtime-api.js";

function makeConfig(): ResolvedMemoryWikiConfig {
  const root = mkdtempSync(path.join(tmpdir(), "memory-wiki-ks08-"));
  return resolveMemoryWikiConfig({
    vault: { path: root },
    search: { backend: "local", corpus: "wiki" },
  });
}

async function createPage(config: ResolvedMemoryWikiConfig, title: string, body: string): Promise<string> {
  const result = await applyMemoryWikiMutation({
    config,
    mutation: normalizeMemoryWikiMutationInput({
      op: "create_synthesis",
      title,
      body,
      sourceIds: [`notes/${title.toLowerCase().replaceAll(" ", "-")}.md`],
      status: "active",
    }),
  });
  return result.pagePath;
}

describe("memory-wiki lifecycle owner mutations (KS-08)", () => {
  let config: ResolvedMemoryWikiConfig;

  beforeEach(() => {
    config = makeConfig();
  });

  afterEach(() => {
    if (config?.vault.path.includes("memory-wiki-ks08-")) {
      rmSync(config.vault.path, { recursive: true, force: true });
    }
  });

  it("update mutates the owner page and read-back proves new body and revision", async () => {
    const lookup = await createPage(config, "Update target", "# Update target\nOld body.");
    const initial = await getMemoryWikiPage({ config, lookup });
    expect(initial?.revision).toBe(1);

    const result = await applyMemoryWikiMutation({
      config,
      mutation: normalizeMemoryWikiMutationInput({
        op: "update_page",
        lookup,
        expectedRevision: 1,
        body: "# Update target\nNew body.",
      }),
    });
    expect(result.status).toBe("active");
    expect(result.revision).toBe(2);
    const readBack = await getMemoryWikiPage({ config, lookup });
    expect(readBack?.content).toContain("New body.");
    expect(readBack?.revision).toBe(2);

    await expect(applyMemoryWikiMutation({
      config,
      mutation: normalizeMemoryWikiMutationInput({
        op: "update_page",
        lookup,
        expectedRevision: 1,
        body: "stale write",
      }),
    })).rejects.toThrow(/stale_revision/);
  });

  it("merge appends source body, merges sourceIds, and read-back proves revision", async () => {
    const target = await createPage(config, "Merge target", "# Merge target\nTarget body.");
    const source = await createPage(config, "Merge source", "# Merge source\nSource body.");
    const result = await applyMemoryWikiMutation({
      config,
      mutation: normalizeMemoryWikiMutationInput({
        op: "merge_page",
        lookup: target,
        sourceLookup: source,
        expectedRevision: 1,
        sourceIds: ["notes/merged-extra.md"],
      }),
    });
    expect(result.revision).toBe(2);
    const readBack = await getMemoryWikiPage({ config, lookup: target });
    expect(readBack?.content).toContain("Target body.");
    expect(readBack?.content).toContain("Merged from Merge source");
    expect(readBack?.content).toContain("Source body.");
    expect(readBack?.revision).toBe(2);
  });

  it("archive sets archived status with revision CAS and read-back proves owner state", async () => {
    const lookup = await createPage(config, "Archive page", "# Archive page\nBody.");
    const result = await applyMemoryWikiMutation({
      config,
      mutation: normalizeMemoryWikiMutationInput({
        op: "archive_page",
        lookup,
        expectedRevision: 1,
      }),
    });
    expect(result.status).toBe("archived");
    expect(result.revision).toBe(2);
    const readBack = await getMemoryWikiPage({ config, lookup });
    expect(readBack?.status).toBe("archived");
    expect(readBack?.revision).toBe(2);
  });

  it("revoke sets revoked status and stale CAS is rejected", async () => {
    const lookup = await createPage(config, "Revoke page", "# Revoke page\nBody.");
    const result = await applyMemoryWikiMutation({
      config,
      mutation: normalizeMemoryWikiMutationInput({
        op: "revoke_page",
        lookup,
        expectedRevision: 1,
      }),
    });
    expect(result.status).toBe("revoked");
    const readBack = await getMemoryWikiPage({ config, lookup });
    expect(readBack?.status).toBe("revoked");

    await expect(applyMemoryWikiMutation({
      config,
      mutation: normalizeMemoryWikiMutationInput({
        op: "archive_page",
        lookup,
        expectedRevision: 1,
      }),
    })).rejects.toThrow(/stale_revision/);
  });

  it("delete removes the owner file and get read-back returns null", async () => {
    const lookup = await createPage(config, "Delete page", "# Delete page\nBody.");
    const result = await applyMemoryWikiMutation({
      config,
      mutation: normalizeMemoryWikiMutationInput({
        op: "delete_page",
        lookup,
        expectedRevision: 1,
      }),
    });
    expect(result.status).toBe("deleted");
    expect(result.revision).toBe(2);
    const readBack = await getMemoryWikiPage({ config, lookup });
    expect(readBack).toBeNull();
  });

  it("restore returns archived/revoked pages to active with revision CAS", async () => {
    const lookup = await createPage(config, "Restore page", "# Restore page\nBody.");
    await applyMemoryWikiMutation({
      config,
      mutation: normalizeMemoryWikiMutationInput({ op: "archive_page", lookup, expectedRevision: 1 }),
    });
    const result = await applyMemoryWikiMutation({
      config,
      mutation: normalizeMemoryWikiMutationInput({ op: "restore_page", lookup, expectedRevision: 2 }),
    });
    expect(result.status).toBe("active");
    expect(result.revision).toBe(3);
    const readBack = await getMemoryWikiPage({ config, lookup });
    expect(readBack?.status).toBe("active");
    expect(readBack?.revision).toBe(3);
  });
});
