// R1-2: guard that core web-fetch surfaces stay free of provider-owned coupling.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectSourceFileContents } from "../scripts/lib/source-file-scan-cache.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanExtensions = new Set([".ts", ".js", ".mjs", ".cjs"]);
const ignoredDirNames = new Set([
  ".artifacts",
  ".git",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "extensions",
  "node_modules",
]);
const allowedFiles = new Set([
  "src/agents/tools/web-fetch.test-harness.ts",
  "src/config/legacy-web-fetch.ts",
  "src/config/zod-schema.agent-runtime.ts",
  "src/secrets/target-registry-data.ts",
]);
const suspiciousPatterns = [
  /fetchFirecrawlContent/,
  /firecrawl-fetch-provider\.js/,
  /createFirecrawlWebFetchProvider/,
  /providerId:\s*"firecrawl"/,
  /provider:\s*"firecrawl"/,
  /id:\s*"firecrawl"/,
];

describe("web provider boundary", () => {
  it("core web-fetch has no Firecrawl-specific coupling", async () => {
    const files = await collectSourceFileContents({
      repoRoot,
      scanRoots: ["src"],
      scanExtensions,
      ignoredDirNames,
    });
    const violations = [];
    for (const { relativeFile, content } of files) {
      if (allowedFiles.has(relativeFile) || relativeFile.includes(".test.") || relativeFile.includes("test-support")) {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (!line.includes("firecrawl") && !line.includes("Firecrawl")) {
          continue;
        }
        if (!suspiciousPatterns.some((pattern) => pattern.test(line))) {
          continue;
        }
        violations.push({ file: relativeFile, line: index + 1 });
      }
    }
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
