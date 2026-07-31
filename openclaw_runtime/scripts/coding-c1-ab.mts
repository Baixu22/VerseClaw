/**
 * C1-2 A/B scorecard: flag off vs on for four coding-nav fixtures + schema occupancy.
 * Run: pnpm --dir openclaw_runtime exec node --import tsx scripts/coding-c1-ab.mts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createContextImpactTool,
  createContextUnderstandTool,
  createContextVerifyTool,
  createDcsContextAgentTools,
  recordContextToolSchemaBudget,
} from "../src/agents/tools/context-agent-tools.js";
import { codingObservability } from "../src/context-engine/coding-observability.js";
import {
  __resetWorkspaceFactServiceRegistry,
  resolveWorkspaceFactService,
} from "../src/context-engine/factstore/workspace-fact-service.js";
import { closeAllFactStores } from "../src/context-engine/factstore/store.js";
import { codingToolRoutingPromptChars } from "../src/context-engine/coding-tool-navigation.js";
import {
  mapToolsToToolRegistryEntries,
  measureContextToolRegistryOccupancy,
} from "../src/context-engine/handlers/tool-registry-handler.js";

type FixtureId = "impact" | "understand" | "verify" | "registration";

type ArmResult = {
  fixture: FixtureId;
  arm: "off" | "on" | "mcp_control";
  toolCalls: number;
  tokenCostStub: number;
  factStoreHits: number;
  factStoreMisses: number;
  evidenceAdopted: boolean;
  pass: boolean;
  notes?: string;
};

function writeFixture(repoRoot: string): void {
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "src", "auth.ts"),
    [
      "export function login(user: string): boolean {",
      "  return user.length > 0;",
      "}",
      "",
      "export function handleRequest(user: string): boolean {",
      "  return login(user);",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "auth.test.ts"),
    [
      "import { login } from './auth';",
      "export function testLogin() {",
      "  return login('x');",
      "}",
      "",
    ].join("\n"),
  );
}

const BASELINE_CALL_PLANS: Record<FixtureId, { tools: string[]; tokenCostStub: number }> = {
  impact: { tools: ["grep", "read", "grep", "read", "read"], tokenCostStub: 5 * 800 },
  understand: { tools: ["exec_ls", "grep", "read", "read", "read"], tokenCostStub: 5 * 900 },
  verify: { tools: ["exec_git_diff", "read", "grep", "read"], tokenCostStub: 4 * 700 },
  registration: { tools: ["grep", "read", "read", "read"], tokenCostStub: 4 * 600 },
};

async function runOnArm(repoRoot: string, fixture: FixtureId): Promise<ArmResult> {
  codingObservability.reset();
  const service = resolveWorkspaceFactService(repoRoot);
  service.materializer.ensureFacts({ paths: ["src/auth.ts", "src/auth.test.ts"] });
  let toolCalls = 0;
  let pass = false;
  let evidenceAdopted = false;
  let notes = "";

  if (fixture === "impact") {
    const tool = createContextImpactTool({ factService: service, viewToolsEnabled: true });
    const raw = await tool!.execute!("ab-impact", { target: "login" });
    const details = (raw as { details: Record<string, unknown> }).details;
    toolCalls = 1;
    evidenceAdopted = Array.isArray(details.evidence) && (details.evidence as unknown[]).length > 0;
    pass = Array.isArray(details.callers);
    notes = `callers=${Array.isArray(details.callers) ? (details.callers as unknown[]).length : 0}`;
  } else if (fixture === "understand") {
    const tool = createContextUnderstandTool({ factService: service, viewToolsEnabled: true });
    const raw = await tool!.execute!("ab-understand", {
      query: "authentication login flow",
      activeFiles: ["src/auth.ts"],
    });
    const details = (raw as { details: Record<string, unknown> }).details;
    toolCalls = 1;
    evidenceAdopted =
      Boolean(details.answerable) ||
      (Array.isArray(details.snippets) && (details.snippets as unknown[]).length > 0);
    pass = details.answerable === true || Array.isArray(details.snippets);
  } else if (fixture === "verify") {
    const tool = createContextVerifyTool({ factService: service, viewToolsEnabled: true });
    const raw = await tool!.execute!("ab-verify", { changedFiles: ["src/auth.ts"] });
    const details = (raw as { details: Record<string, unknown> }).details;
    toolCalls = 1;
    evidenceAdopted = Array.isArray(details.relatedTests) && (details.relatedTests as unknown[]).length > 0;
    pass = Array.isArray(details.relatedTests);
  } else {
    const tools = createDcsContextAgentTools({
      sessionId: "ab-reg",
      blockStore: { query: async () => [], queryByEntity: async () => [] },
      contextBlockSink: async () => [{ accepted: true }],
      factService: service,
      viewToolsEnabled: true,
    });
    toolCalls = 1;
    pass = tools.length === 7;
    evidenceAdopted = pass;
    notes = `toolCount=${tools.length}`;
  }

  const snap = codingObservability.snapshot();
  return {
    fixture,
    arm: "on",
    toolCalls,
    tokenCostStub: toolCalls * 400,
    factStoreHits: snap.factStoreHits,
    factStoreMisses: snap.factStoreMisses,
    evidenceAdopted,
    pass,
    notes,
  };
}

function runOffArm(fixture: FixtureId): ArmResult {
  const plan = BASELINE_CALL_PLANS[fixture];
  return {
    fixture,
    arm: "off",
    toolCalls: plan.tools.length,
    tokenCostStub: plan.tokenCostStub,
    factStoreHits: 0,
    factStoreMisses: 0,
    evidenceAdopted: false,
    pass: true,
    notes: `plan=${plan.tools.join(">")}`,
  };
}

function runMcpControl(fixture: FixtureId): ArmResult {
  const evalRoot = path.resolve(process.cwd(), "..", "..", "tools", "eval-codebase-memory-mcp");
  const pkg = path.join(evalRoot, "package.json");
  if (!existsSync(pkg)) {
    return {
      fixture,
      arm: "mcp_control",
      toolCalls: Number.NaN,
      tokenCostStub: Number.NaN,
      factStoreHits: 0,
      factStoreMisses: 0,
      evidenceAdopted: false,
      pass: false,
      notes: "eval package missing ? control arm unavailable (not a prod dep)",
    };
  }
  try {
    const rawPkg = readFileSync(pkg, "utf8").replace(/^\uFEFF/, "");
    const json = JSON.parse(rawPkg) as { dependencies?: Record<string, string> };
    const ver = json.dependencies?.["codebase-memory-mcp"] ?? "present";
    return {
      fixture,
      arm: "mcp_control",
      toolCalls: 1,
      tokenCostStub: 500,
      factStoreHits: 0,
      factStoreMisses: 0,
      evidenceAdopted: false,
      pass: true,
      notes: `eval-only package codebase-memory-mcp@${ver}; not executed (iron law 1)`,
    };
  } catch (err) {
    return {
      fixture,
      arm: "mcp_control",
      toolCalls: Number.NaN,
      tokenCostStub: Number.NaN,
      factStoreHits: 0,
      factStoreMisses: 0,
      evidenceAdopted: false,
      pass: false,
      notes: String(err),
    };
  }
}

async function main(): Promise<void> {
  __resetWorkspaceFactServiceRegistry();
  closeAllFactStores();
  codingObservability.reset();
  const repoRoot = mkdtempSync(path.join(tmpdir(), "c1-ab-"));
  const fixtures: FixtureId[] = ["impact", "understand", "verify", "registration"];
  const results: ArmResult[] = [];
  try {
    writeFixture(repoRoot);
    for (const fixture of fixtures) {
      results.push(runOffArm(fixture));
      results.push(await runOnArm(repoRoot, fixture));
      results.push(runMcpControl(fixture));
    }

    process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS = "1";
    const service = resolveWorkspaceFactService(repoRoot);
    const tools = createDcsContextAgentTools({
      sessionId: "schema",
      blockStore: { query: async () => [], queryByEntity: async () => [] },
      contextBlockSink: async () => [{ accepted: true }],
      factService: service,
      viewToolsEnabled: true,
    });
    const schemaBudget = recordContextToolSchemaBudget(tools);
    const registry = measureContextToolRegistryOccupancy(
      mapToolsToToolRegistryEntries(tools, { schemaMode: "summary" }),
    );

    const pairs = fixtures.map((fixture) => {
      const off = results.find((r) => r.fixture === fixture && r.arm === "off")!;
      const on = results.find((r) => r.fixture === fixture && r.arm === "on")!;
      const reduction = off.toolCalls / Math.max(on.toolCalls, 1);
      return { fixture, offCalls: off.toolCalls, onCalls: on.toolCalls, reduction, onPass: on.pass };
    });
    const meanOffCalls =
      pairs.reduce((sum, pair) => sum + pair.offCalls, 0) / Math.max(pairs.length, 1);
    const meanOnCalls =
      pairs.reduce((sum, pair) => sum + pair.onCalls, 0) / Math.max(pairs.length, 1);
    const avgReduction = meanOnCalls > 0 ? meanOffCalls / meanOnCalls : 0;
    const targetReduction = 5;
    const meetsGate = avgReduction >= targetReduction && pairs.every((p) => p.onPass);

    const report = {
      generatedAt: new Date().toISOString(),
      wave: "C1-2",
      targetReduction,
      avgReduction: Number(avgReduction.toFixed(3)),
      reductionDefinition: {
        formula: "mean(offArm toolCalls) / mean(onArm toolCalls) (ratio of means)",
        corpusId: "coding-c1-hand-authored-real-tools",
        corpus:
          "hand-authored C1-2 navigation fixtures (impact/understand/verify/registration)",
        fixtureCount: pairs.length,
        meanOffCalls: Number(meanOffCalls.toFixed(4)),
        meanOnCalls: Number(meanOnCalls.toFixed(4)),
        live: false,
        evidenceClass: "real-tool-execution-fixture",
        role: "gate-authority",
        authoritativeDecision:
          "artifacts/first-product-preview/FP-P4-05/decision.json",
        reconciliation:
          "artifacts/first-product-preview/FP-P0-05/reduction-factor-reconciliation.md",
      },
      meetsGate,
      judgment: meetsGate ? "meets_target" : "below_target",
      defaultFlipRecommendation: meetsGate
        ? "KEEP default-off; metric threshold alone cannot authorize a default flip"
        : "KEEP shadow/default-off; see gaps",
      gaps: meetsGate
        ? []
        : [
            avgReduction < targetReduction
              ? `avg tool-call reduction ${avgReduction.toFixed(2)}x < ${targetReduction}x target`
              : null,
            ...pairs.filter((p) => !p.onPass).map((p) => `${p.fixture} on-arm failed`),
          ].filter(Boolean),
      pairs,
      results,
      schema: {
        ...schemaBudget,
        registry,
        c0BaselineFullCatalog: { toolCount: 34, schemaChars: 41484 },
        routingPromptChars: codingToolRoutingPromptChars(),
      },
      evidenceNotes: {
        offArm: "Fixed native multi-step plans for same nav questions (call-count baseline)",
        onArm: "Real createContext*Tool execute against WorkspaceFactService fixture",
        mcpControl: "Eval package presence only; iron law forbids prod MCP execution",
      },
    };

    const outDir = path.resolve(process.cwd(), "..", "artifacts", "coding-c1");
    mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "ab-metrics.json");
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nWrote ${outPath}`);
  } finally {
    __resetWorkspaceFactServiceRegistry();
    closeAllFactStores();
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
