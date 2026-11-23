// Memory Wiki plugin module implements ingest behavior.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathExists } from "openclaw/plugin-sdk/security-runtime";
import { compileMemoryWikiVault } from "./compile.js";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import { appendMemoryWikiLog } from "./log.js";
import { parseWikiMarkdown, renderMarkdownFence, renderWikiMarkdown, slugifyWikiSegment } from "./markdown.js";
import { resolveMemoryWikiTimestamp } from "./time.js";
import { initializeMemoryWikiVault } from "./vault.js";
import { readQueryableWikiPages } from "./query.js";
import { withWikiMutationLock } from "./mutation-lock.js";

type IngestMemoryWikiSourceResult = {
  sourcePath: string;
  pageId: string;
  pagePath: string;
  title: string;
  bytes: number;
  created: boolean;
  indexUpdatedFiles: string[];
};

function resolveSourceTitle(sourcePath: string, explicitTitle?: string): string {
  if (explicitTitle?.trim()) {
    return explicitTitle.trim();
  }
  return path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]+/g, " ").trim();
}

function assertUtf8Text(buffer: Buffer, sourcePath: string): string {
  if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) {
    throw new Error(`Cannot ingest empty or oversized source: ${sourcePath}`);
  }
  if (buffer.includes(0)) {
    throw new Error(`Cannot ingest binary file as markdown source: ${sourcePath}`);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
    if (!text.trim()) throw new Error("Source has no content");
    return text;
  } catch (error) {
    throw new Error(`Cannot ingest source with invalid UTF-8: ${sourcePath}`, { cause: error });
  }
}

export async function ingestMemoryWikiSource(params: {
  config: ResolvedMemoryWikiConfig;
  inputPath: string;
  title?: string;
  nowMs?: number;
}): Promise<IngestMemoryWikiSourceResult> {
  return withWikiMutationLock(params.config.vault.path, async () => {
    await initializeMemoryWikiVault(params.config, { nowMs: params.nowMs });
    const sourcePath = await fs.realpath(path.resolve(params.inputPath));
    const buffer = await fs.readFile(sourcePath);
    const content = assertUtf8Text(buffer, sourcePath);
    const title = resolveSourceTitle(sourcePath, params.title);
    const identity = process.platform === "win32" ? sourcePath.toLowerCase() : sourcePath;
    const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 16);
    const slug = `${slugifyWikiSegment(resolveSourceTitle(sourcePath))}-${suffix}`;
    // Reuse the page owned by this source, preserving notes on older imports too.
    const owned = (await readQueryableWikiPages(params.config.vault.path)).find(page => {
      if (page.pageType !== "source" || page.sourceType !== "local-file") return false;
      const stored = parseWikiMarkdown(page.raw).frontmatter.sourcePath;
      return typeof stored === "string" && (process.platform === "win32" ? path.resolve(stored).toLowerCase() : path.resolve(stored)) === identity;
    });
    const pageId = owned?.id ?? `source.${slug}`;
    const pageRelativePath = owned?.relativePath ?? path.join("sources", `${slug}.md`);
    const pagePath = path.join(params.config.vault.path, pageRelativePath);
    const created = !(await pathExists(pagePath));
    const previous = created ? "" : await fs.readFile(pagePath, "utf8");
    const previousPage = parseWikiMarkdown(previous);
    const notes = previousPage.body.match(/<!-- openclaw:human:start -->[\s\S]*?<!-- openclaw:human:end -->/u)?.[0];
    const timestamp = resolveMemoryWikiTimestamp(params.nowMs);

    const markdown = renderWikiMarkdown({
      frontmatter: {
        ...previousPage.frontmatter,
        pageType: "source",
        id: pageId,
        title,
        sourceType: "local-file",
        sourcePath,
        revision: created ? 1 : (typeof previousPage.frontmatter.revision === "number" ? previousPage.frontmatter.revision : 1) + 1,
        ingestedAt: timestamp,
        updatedAt: timestamp,
        status: "active",
      },
      body: [
        `# ${title}`,
        "",
        "## Source",
        `- Type: \`local-file\``,
        `- Path: \`${sourcePath}\``,
        `- Bytes: ${buffer.byteLength}`,
        `- Updated: ${timestamp}`,
        "",
        "## Content",
        renderMarkdownFence(content, "text"),
        "",
        "## Notes",
        notes ?? "<!-- openclaw:human:start -->\n<!-- openclaw:human:end -->",
        "",
      ].join("\n"),
    });

    await fs.writeFile(pagePath, markdown, "utf8");
    await appendMemoryWikiLog(params.config.vault.path, {
      type: "ingest",
      timestamp,
      details: {
        inputPath: sourcePath,
        pageId,
        pagePath: pageRelativePath.split(path.sep).join("/"),
        bytes: buffer.byteLength,
        created,
      },
    });
    const compile = await compileMemoryWikiVault(params.config);

    return {
      sourcePath,
      pageId,
      pagePath: pageRelativePath.split(path.sep).join("/"),
      title,
      bytes: buffer.byteLength,
      created,
      indexUpdatedFiles: compile.updatedFiles,
    };
  });
}
