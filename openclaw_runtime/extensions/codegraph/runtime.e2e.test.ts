import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import entry from "./index";

type RegisteredTool = {
  tool: {
    name: string;
    execute: (toolCallId: string, args: unknown) => Promise<any>;
  };
  opts?: unknown;
};

const extensionRoot = path.dirname(fileURLToPath(import.meta.url));
const expectedToolNames = [
  "codegraph_decide",
  "codegraph_context_plan",
  "codegraph_explore",
  "codegraph_search",
  "codegraph_callers",
  "codegraph_callees",
  "codegraph_impact",
  "codegraph_status",
  "codegraph_sync",
  "codegraph_init",
  "codegraph_entrypoints",
  "codegraph_find_flow",
  "codegraph_minimal_context",
  "codegraph_git_stats",
  "codegraph_freshness",
];

function registerTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  entry.register({
    registerTool(tool: RegisteredTool["tool"], opts?: unknown) {
      tools.push({ tool, opts });
    },
  } as any);
  return tools;
}

function getTool(tools: RegisteredTool[], name: string): RegisteredTool["tool"] {
  const item = tools.find((entry) => entry.tool.name === name);
  if (!item) throw new Error(`Missing CodeGraph tool: ${name}`);
  return item.tool;
}

function writeProject(root: string) {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "routes.ts"),
    [
      "import { registerUserController } from './user-controller';",
      "export const routes = [{ method: 'POST', path: '/users', handler: registerUserController }];",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "src", "user-controller.ts"),
    [
      "import { createUser } from './user-service';",
      "export function registerUserController(input: { email: string }) {",
      "  return createUser(input.email);",
      "}",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "src", "user-service.ts"),
    [
      "import { saveUser } from './user-repository';",
      "export function createUser(email: string) {",
      "  if (!email.includes('@')) throw new Error('invalid email');",
      "  return saveUser({ email });",
      "}",
      "export function validateUserEmail(email: string) {",
      "  return email.includes('@');",
      "}",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "src", "user-repository.ts"),
    [
      "export function saveUser(record: { email: string }) {",
      "  return { id: 'u_1', ...record };",
      "}",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "tests", "user-service.test.ts"),
    [
      "import { createUser } from '../src/user-service';",
      "export function testCreateUser() {",
      "  return createUser('a@example.com').id;",
      "}",
      "",
    ].join("\n"),
  );
}

function assertRegisteredContracts(tools: RegisteredTool[]) {
  const manifestPath = path.join(extensionRoot, "openclaw.plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const registeredNames = tools.map((item) => item.tool.name).sort();
  const manifestNames = [...manifest.contracts.tools].sort();

  expect(registeredNames).toEqual([...expectedToolNames].sort());
  expect(manifestNames).toEqual(registeredNames);
}

function assertStaticAssetsComplete() {
  const packagePath = path.join(extensionRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const assets = pkg.openclaw.build.staticAssets as Array<{ source: string }>;
  const missing = assets.filter((asset) => !fs.existsSync(path.join(extensionRoot, asset.source)));
  expect(assets.length).toBeGreaterThanOrEqual(688);
  expect(missing).toHaveLength(0);
  expect(fs.existsSync(path.join(extensionRoot, "dist", "package.json"))).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(extensionRoot, "dist", "package.json"), "utf8"))).toEqual({
    type: "commonjs",
  });
  return { staticAssetCount: assets.length, missingStaticAssetCount: missing.length };
}

describe("CodeGraph runtime base e2e", () => {
  const tempRoots: string[] = [];

  afterAll(() => {
    for (const root of tempRoots) {
      try {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        // CodeGraph keeps a runtime watcher for the process lifetime. On
        // Windows that can transiently hold the temp workspace; the OS temp
        // directory is acceptable for this e2e smoke and should not fail the
        // functional assertions.
      }
    }
  });

  it("registers native runtime tools and provides bounded project cognition", async () => {
    const startedAt = Date.now();
    const tools = registerTools();
    assertRegisteredContracts(tools);
    const assetMetrics = assertStaticAssetsComplete();

    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-codegraph-e2e-"));
    tempRoots.push(workspacePath);
    writeProject(workspacePath);

    const init = await getTool(tools, "codegraph_init").execute("init", { workspacePath });
    const stats = init.details.stats;
    expect(stats.fileCount).toBe(5);
    expect(stats.nodeCount).toBeGreaterThanOrEqual(5);

    const decision = await getTool(tools, "codegraph_decide").execute("decide", {
      userIntent: "修改 src/user-service.ts 里的邮箱校验",
      operationType: "modify",
      knownFiles: ["src/user-service.ts"],
    });
    expect(decision.details.shouldUseCodeGraph).toBe(false);
    expect(decision.details.mustReadSource).toBe(true);
    expect(decision.details.sourceReadPolicy).toBe("read_named_files_before_edit_or_claim");

    const directPlan = await getTool(tools, "codegraph_context_plan").execute("direct-plan", {
      workspacePath,
      task: "修改 src/user-service.ts 里的邮箱校验",
      operationType: "modify",
      knownFiles: ["src/user-service.ts"],
    });
    expect(directPlan.details.source).toBe("decision-only");
    expect(directPlan.details.filesToRead[0]).toMatchObject({
      filePath: "src/user-service.ts",
      readDepth: "deep",
    });

    const graphPlan = await getTool(tools, "codegraph_context_plan").execute("graph-plan", {
      workspacePath,
      task: "定位 register user 流程和 createUser 的影响面",
      operationType: "locate",
      maxFiles: 6,
      maxSymbols: 8,
    });
    expect(graphPlan.details.decision.shouldUseCodeGraph).toBe(true);
    expect(graphPlan.details.source).toBe("decision+codegraph");
    expect(graphPlan.details.filesToRead.length).toBeGreaterThan(0);
    expect(graphPlan.details.filesToRead.length).toBeLessThanOrEqual(6);
    expect(graphPlan.details.filesToRead.some((file: any) => file.filePath.includes("user-service.ts"))).toBe(true);

    const search = await getTool(tools, "codegraph_search").execute("search", {
      workspacePath,
      query: "createUser",
      limit: 5,
      freshnessMode: "balanced",
    });
    expect(search.details.totalCount).toBeGreaterThanOrEqual(1);
    expect(search.details.retrieval.liveFiles.missingFileCount).toBe(0);

    fs.appendFileSync(
      path.join(workspacePath, "src", "user-service.ts"),
      "\nexport function normalizeUserEmail(email: string) { return email.trim().toLowerCase(); }\n",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const fast = await getTool(tools, "codegraph_search").execute("fast-stale", {
      workspacePath,
      query: "normalizeUserEmail",
      limit: 5,
      freshnessMode: "fast",
    });
    expect(fast.details.freshness.status).toBe("stale");
    expect(fast.details.freshness.pendingDirtyFileCount).toBeGreaterThanOrEqual(1);

    const balanced = await getTool(tools, "codegraph_search").execute("balanced-refresh", {
      workspacePath,
      query: "normalizeUserEmail",
      limit: 5,
      freshnessMode: "balanced",
    });
    expect(balanced.details.freshness.status).toMatch(/fresh|refreshed/u);
    expect(balanced.details.totalCount).toBeGreaterThanOrEqual(1);
    expect(balanced.details.retrieval.confidence).toBeGreaterThanOrEqual(0.9);

    const freshness = await getTool(tools, "codegraph_freshness").execute("freshness", {
      workspacePath,
      freshnessMode: "strict",
    });
    expect(freshness.details.fresh).toBe(true);

    const e2eMetrics = {
      registeredToolCount: tools.length,
      manifestToolCount: expectedToolNames.length,
      ...assetMetrics,
      indexedFileCount: stats.fileCount,
      indexedNodeCount: stats.nodeCount,
      directPlanFileCount: directPlan.details.filesToRead.length,
      graphPlanFileCount: graphPlan.details.filesToRead.length,
      graphPlanSymbolCount: graphPlan.details.symbolsToInspect.length,
      searchResultCount: search.details.totalCount,
      fastFreshnessStatus: fast.details.freshness.status,
      balancedFreshnessStatus: balanced.details.freshness.status,
      balancedChangedFileCount: balanced.details.freshness.changedFileCount,
      balancedRetrievalConfidence: balanced.details.retrieval.confidence,
      durationMs: Date.now() - startedAt,
    };

    const artifactDir = path.resolve(extensionRoot, "..", "..", ".artifacts");
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactDir, "codegraph-runtime-e2e-metrics.json"),
      `${JSON.stringify(e2eMetrics, null, 2)}\n`,
    );

    // Printed intentionally: this e2e is also the quantitative runtime smoke for
    // the CodeGraph base layer.
    console.log(`CODEGRAPH_E2E_METRICS ${JSON.stringify(e2eMetrics)}`);
  }, 60_000);
});
