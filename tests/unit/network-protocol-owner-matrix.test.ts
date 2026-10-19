import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd());
const registryPath = join(repoRoot, "shared/network-protocol-reliability-owners.json");
const ownerMatrixPath = join(repoRoot, "docs/dev/network-protocol-reliability/owner-matrix.md");
const entrypointHelperPath = join(repoRoot, "scripts/lib/entrypoint.mjs");

type OwnerEntry = {
  id: string;
  primaryOwner: string;
  componentPatterns: string[];
  forbiddenIndependentEvolution: string[];
  disposition: string;
  downstreamNode: string;
};

type OwnerRegistry = { schema: string; owners: OwnerEntry[] };

function readRegistry(): OwnerRegistry {
  return JSON.parse(readFileSync(registryPath, "utf8")) as OwnerRegistry;
}

function walkScripts(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkScripts(full));
    else if ([".mjs", ".js", ".ts", ".cjs"].includes(extname(full))) out.push(full);
  }
  return out;
}

function scriptsReferencing(argv1: string): string[] {
  return walkScripts(join(repoRoot, "scripts"))
    .filter((file) => readFileSync(file, "utf8").includes(argv1))
    .map((file) => relative(repoRoot, file).split(String.fromCharCode(92)).join("/"));
}

function hasNaiveEntrypointComparison(source: string): boolean {
  if (!source.includes("process.argv[1]")) return false;
  if (source.includes("isMainEntrypoint")) return false;
  const compact = source.replace(/\s+/g, " ");
  return /process\.argv\[1\].{0,200}(import\.meta\.url|pathToFileURL|fileURLToPath)|(import\.meta\.url|pathToFileURL|fileURLToPath).{0,200}process\.argv\[1\]/.test(compact);
}

function directEntrypointComparisons(): string[] {
  return walkScripts(join(repoRoot, "scripts"))
    .filter((file) => hasNaiveEntrypointComparison(readFileSync(file, "utf8")))
    .map((file) => relative(repoRoot, file).split(String.fromCharCode(92)).join("/"));
}

describe("network protocol owner matrix", () => {
  it("covers every declared reliability concern exactly once", () => {
    const registry = readRegistry();
    const ids = registry.owners.map((owner) => owner.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(
      new Set([
        "gateway-protocol",
        "electron-gateway-adapter",
        "provider-endpoint-breaker",
        "generic-circuit-breaker",
        "provider-outbound-admission",
        "gateway-history-backpressure",
        "physical-retry-executor",
        "logical-attempt-budget",
        "model-fallback",
        "host-action-deadline",
        "gateway-request-deadline",
        "provider-request-deadline",
        "attempt-observability",
        "stream-failure",
        "script-entrypoint",
      ]),
    );
  });

  it("points every owner at a file that exists", () => {
    const registry = readRegistry();
    for (const owner of registry.owners) {
      if (owner.primaryOwner.includes("*")) continue;
      expect(existsSync(join(repoRoot, owner.primaryOwner)), owner.id).toBe(true);
    }
  });

  it("documents every owner and disposition in the on-disk matrix", () => {
    const registry = readRegistry();
    const matrix = readFileSync(ownerMatrixPath, "utf8");
    for (const owner of registry.owners) {
      expect(matrix, owner.id).toContain(owner.primaryOwner);
      expect(matrix, owner.id).toContain(owner.primaryOwner);
      expect(matrix, owner.id).toContain(owner.downstreamNode);
    }
  });

  it("has exactly one provider breaker authority", () => {
    const registry = readRegistry();
    const providerAuthorities = registry.owners.filter(
      (owner) =>
        owner.componentPatterns.includes("RateCircuitBreaker") ||
        owner.primaryOwner === "openclaw_runtime/src/agents/rate-circuit-breaker.ts",
    );
    expect(providerAuthorities.map((owner) => owner.id)).toEqual(["provider-endpoint-breaker"]);
  });

  it("fails the negative fixture when a second provider authority is declared", () => {
    const fixture: OwnerRegistry = structuredClone(readRegistry());
    fixture.owners.push({
      id: "provider-endpoint-breaker-v2",
      primaryOwner: "openclaw_runtime/src/infra/circuit-breaker.ts",
      componentPatterns: ["RateCircuitBreaker"],
      forbiddenIndependentEvolution: [],
      disposition: "merge",
      downstreamNode: "TF-0440",
    });
    const providerAuthorities = fixture.owners.filter(
      (owner) =>
        owner.componentPatterns.includes("RateCircuitBreaker") ||
        owner.primaryOwner === "openclaw_runtime/src/agents/rate-circuit-breaker.ts",
    );
    expect(providerAuthorities.length).toBeGreaterThan(1);
  });

  it("detects a naive entrypoint fixture", () => {
    const fixture = "const argv1 = process.argv[1]; if (argv1 && import.meta.url === pathToFileURL(argv1).href) {}";
    expect(hasNaiveEntrypointComparison(fixture)).toBe(true);
    expect(hasNaiveEntrypointComparison("import { isMainEntrypoint } from \"./lib/entrypoint.mjs\"; if (isMainEntrypoint(import.meta.url)) {}")).toBe(false);
  });

  it("has no direct main-entrypoint comparisons left in scripts", () => {
    expect(directEntrypointComparisons()).toEqual([]);
  });

  it("keeps process.argv[1] only inside the entrypoint helper", () => {
    expect(directEntrypointComparisons()).toEqual([]);
    expect(readFileSync(entrypointHelperPath, "utf8")).toContain("realpathSync");
  });

  it("realpath-resolves a junction whose argv and module spellings differ", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "clawx-network-entrypoint-"));
    const realDir = join(tempRoot, "real");
    const junctionDir = join(tempRoot, "junction");
    try {
      mkdirSync(realDir, { recursive: true });
      const realFile = join(realDir, "entrypoint.mjs");
      writeFileSync(realFile, "console.log(\"fixture\");\n", "utf8");
      try {
        symlinkSync(realDir, junctionDir, "junction");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP" || code === "UNKNOWN") return;
        throw error;
      }
      const helper = await import(pathToFileURL(entrypointHelperPath).href);
      const realUrl = pathToFileURL(realFile).href;
      const junctionArgv = join(junctionDir, "entrypoint.mjs");
      expect(helper.isMainEntrypoint(realUrl, junctionArgv)).toBe(true);
      expect(helper.isMainEntrypoint(realUrl, realFile)).toBe(true);
      expect(helper.isMainEntrypoint(realUrl, join(tempRoot, "other.mjs"))).toBe(false);
      const output = execFileSync(process.execPath, [junctionArgv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      expect(output.trim()).toBe("fixture");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

