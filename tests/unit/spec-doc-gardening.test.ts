// @vitest-environment node
// G02: spec/doc gardening boundary - lifecycle present, docs resolve, entry stays routable.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TASKS = join(ROOT, "harness", "specs", "tasks");
const LIFECYCLE = new Set(["active", "completed", "archived"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function frontmatterStatus(text: string): string | undefined {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  const line = match[1].split("\n").find((l) => l.startsWith("lifecycleStatus:"));
  return line?.slice("lifecycleStatus:".length).trim();
}

describe("G02 spec/doc gardening boundary", () => {
  it("every task spec carries a valid lifecycleStatus (archive, never mechanical delete)", () => {
    const missing: string[] = [];
    const invalid: string[] = [];
    for (const file of walk(TASKS)) {
      const status = frontmatterStatus(readFileSync(file, "utf8"));
      const rel = relative(ROOT, file).split(sep).join("/");
      if (!status) missing.push(rel);
      else if (!LIFECYCLE.has(status)) invalid.push(`${rel}: ${status}`);
    }
    expect(missing, `missing lifecycleStatus:\n${missing.join("\n")}`).toEqual([]);
    expect(invalid, `invalid lifecycleStatus:\n${invalid.join("\n")}`).toEqual([]);
  });

  it("keeps the AGENTS.md entry routable (not an ossified spec dump)", () => {
    const text = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    const lines = text.split("\n").length;
    expect(lines).toBeLessThanOrEqual(400);
    // It routes to the durable policy home rather than duplicating it.
    expect(text).toContain("harness/specs");
  });

  it("has a single doc-gardening rule and does not create a parallel spec list", () => {
    const rulesDir = join(ROOT, "harness", "specs", "rules");
    const rules = readdirSync(rulesDir).filter((name) => name.endsWith(".md"));
    const gardening = rules.filter((name) => /doc-gardening|ossification/.test(name));
    expect(gardening).toEqual(["spec-doc-gardening-boundary.md"]);
    // The rule must name the executable check, not just prose.
    const rule = readFileSync(join(rulesDir, "spec-doc-gardening-boundary.md"), "utf8");
    expect(rule).toContain("check-spec-lifecycle.mjs");
    expect(statSync(join(ROOT, "scripts", "check-spec-lifecycle.mjs")).isFile()).toBe(true);
  });
});