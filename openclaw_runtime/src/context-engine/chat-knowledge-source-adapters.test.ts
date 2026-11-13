import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryWikiChatKnowledgeSourceAdapter } from "./chat-knowledge-source-adapters.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("MemoryWikiChatKnowledgeSourceAdapter", () => {
  it("reads the explicitly configured isolated vault rather than the default vault", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "g4-wiki-adapter-"));
    roots.push(root);
    await mkdir(path.join(root, "sources"), { recursive: true });
    await writeFile(path.join(root, "sources", "page.md"), [
      "---", "id: source.page", "title: Page", "pageType: source", "status: active", "---",
      "# Page", "isolated-vault-marker", "",
    ].join("\n"));
    const cfg = { plugins: { enabled: true, entries: { "memory-wiki": { enabled: true, config: {
      vault: { path: root }, search: { backend: "local", corpus: "wiki" },
    } } } } };
    const adapter = new MemoryWikiChatKnowledgeSourceAdapter(cfg);
    const result = await adapter.resolve({ id: "page", title: "Page", lookup: "sources/page.md" });
    expect(result).toMatchObject({ status: "resolved", resolved: {
      owner: "memory-wiki", subjectId: "sources/page.md", content: expect.stringContaining("isolated-vault-marker"),
    } });
  });
});
