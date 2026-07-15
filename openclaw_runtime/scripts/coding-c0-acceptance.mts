/**
 * C0-1' acceptance: real FactStore materialization + context_impact callers/evidence.
 * Run: pnpm --dir openclaw_runtime exec node --import tsx scripts/coding-c0-acceptance.mts
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CONTEXT_IMPACT_TOOL_NAME,
  CONTEXT_REUSE_TOOL_NAME,
  CONTEXT_UNDERSTAND_TOOL_NAME,
  CONTEXT_VERIFY_TOOL_NAME,
  createContextImpactTool,
  createContextReuseTool,
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

async function main(): Promise<void> {
  __resetWorkspaceFactServiceRegistry();
  closeAllFactStores();
  codingObservability.reset();
  const repoRoot = mkdtempSync(path.join(tmpdir(), "c0-accept-"));
  try {
    writeFixture(repoRoot);
    const service = resolveWorkspaceFactService(repoRoot);
    service.materializer.ensureFacts({ paths: ["src/auth.ts", "src/auth.test.ts"] });

    const impactTool = createContextImpactTool({ factService: service, viewToolsEnabled: true });
    if (!impactTool?.execute) throw new Error("context_impact missing");
    const impactRaw = await impactTool.execute("c0-impact", { target: "login" });
    const impact = (impactRaw as { details: Record<string, unknown> }).details;

    const understandTool = createContextUnderstandTool({ factService: service, viewToolsEnabled: true });
    const understandRaw = await understandTool!.execute!("c0-understand", {
      query: "authentication login flow",
      activeFiles: ["src/auth.ts"],
    });
    const understand = (understandRaw as { details: Record<string, unknown> }).details;

    const reuseTool = createContextReuseTool({ factService: service, viewToolsEnabled: true });
    const reuseRaw = await reuseTool!.execute!("c0-reuse", { query: "login helper" });
    const reuse = (reuseRaw as { details: Record<string, unknown> }).details;

    const verifyTool = createContextVerifyTool({ factService: service, viewToolsEnabled: true });
    const verifyRaw = await verifyTool!.execute!("c0-verify", {
      changedFiles: ["src/auth.ts"],
    });
    const verify = (verifyRaw as { details: Record<string, unknown> }).details;

    const allSeven = createDcsContextAgentTools({
      sessionId: "c0",
      blockStore: {
        query: async () => [],
        queryByEntity: async () => [],
      },
      contextBlockSink: async () => [{ accepted: true }],
      factService: service,
      viewToolsEnabled: true,
    });
    const schema = recordContextToolSchemaBudget(allSeven);
    const metrics = codingObservability.snapshot();

    const evidence = {
      ok: true,
      tools: [
        CONTEXT_UNDERSTAND_TOOL_NAME,
        CONTEXT_IMPACT_TOOL_NAME,
        CONTEXT_REUSE_TOOL_NAME,
        CONTEXT_VERIFY_TOOL_NAME,
      ],
      impact: {
        callers: impact.callers,
        evidence: impact.evidence,
        riskLevel: impact.riskLevel,
        evidenceCount: Array.isArray(impact.evidence) ? impact.evidence.length : 0,
      },
      understand: {
        answerable: understand.answerable,
        snippetCount: Array.isArray(understand.snippets) ? understand.snippets.length : 0,
      },
      reuse: {
        decision: reuse.decision,
        candidateCount: Array.isArray(reuse.candidates) ? reuse.candidates.length : 0,
      },
      verify: {
        relatedTests: verify.relatedTests,
        riskLevel: verify.riskLevel,
      },
      schema: {
        toolCount: schema.toolCount,
        schemaChars: schema.schemaChars,
        baselineSchemaChars: 39625,
        baselineToolCount: 30,
        deltaSchemaChars: schema.schemaChars, // seven-tool shell only; full catalog measured in W5 E2E
        note: "W0-4: full-catalog delta recorded in CODING-C0-COMPLETE from W5-style schemaChars; this is the 7 context_* shell occupancy.",
      },
      metrics: {
        factToolCalls: metrics.factToolCalls,
        factStoreHits: metrics.factStoreHits,
        factStoreMisses: metrics.factStoreMisses,
        schemaToolCount: metrics.schemaToolCount,
        schemaChars: metrics.schemaChars,
      },
    };

    // Acceptance gate: impact must return callers array + evidence radius fields.
    if (!Array.isArray(impact.callers) || !Array.isArray(impact.evidence)) {
      throw new Error("context_impact missing callers/evidence");
    }

    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    __resetWorkspaceFactServiceRegistry();
    closeAllFactStores();
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});