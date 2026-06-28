import * as ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentMapInternalsForTest,
  buildAgentMapRequestFixture,
  buildBudgetedAgentMapResult,
  isAgentMapDiagnostic,
  isAgentMapResult,
  type AgentMapDiagnosticCode,
  type AgentMapRequest,
  type AgentMapResult,
  type AgentMapSourceFile,
} from "../../openclaw_runtime/src/runtime-core";

describe("AgentMap real-repo input hardening", () => {
  afterEach(() => {
    agentMapInternalsForTest.setTypeScriptRuntimeForTest(null);
  });

  it("skips large files while preserving processable symbols", async () => {
    const result = await buildBudgetedAgentMapResult({
      request: buildHardeningRequest(["src/large.ts", "src/ok.ts"], {
        mentionedSymbols: ["okFeature"],
      }),
      files: [
        source("src/large.ts", `export const tooLarge = "${"x".repeat(256)}";`),
        source("src/ok.ts", "export function okFeature() { return true; }\n"),
      ],
      inputLimits: { maxFileBytes: 96 },
      contextLines: 0,
    });

    expect(isAgentMapResult(result)).toBe(true);
    expect(diagnosticCodes(result)).toContain("max_file_bytes_exceeded");
    expect(result.includedSymbols.map((symbol) => symbol.tag.name)).toContain("okFeature");
    expect(result.excludedFiles).toContainEqual(expect.objectContaining({
      file: "src/large.ts",
      included: false,
      reason: "diagnostic",
      metadata: expect.objectContaining({
        diagnosticCodes: expect.arrayContaining(["max_file_bytes_exceeded"]),
      }),
    }));
  });

  it("skips ignored directories before extraction", async () => {
    const result = await buildBudgetedAgentMapResult({
      request: buildHardeningRequest([
        "node_modules/pkg/index.ts",
        "src/app.ts",
      ], {
        mentionedSymbols: ["appFeature"],
      }),
      files: [
        source("node_modules/pkg/index.ts", "export function dependencyFeature() { return true; }\n"),
        source("src/app.ts", "export function appFeature() { return true; }\n"),
      ],
      contextLines: 0,
    });

    expect(diagnosticCodes(result)).toContain("ignored_directory");
    expect(result.includedSymbols.map((symbol) => symbol.tag.name)).toContain("appFeature");
    expect(result.includedSymbols.map((symbol) => symbol.tag.name)).not.toContain("dependencyFeature");
    expect(result.excludedFiles).toContainEqual(expect.objectContaining({
      file: "node_modules/pkg/index.ts",
      reason: "diagnostic",
    }));
  });

  it("enforces the max files boundary deterministically", async () => {
    const result = await buildBudgetedAgentMapResult({
      request: buildHardeningRequest(["src/first.ts", "src/second.ts"], {
        mentionedSymbols: ["firstFeature", "secondFeature"],
      }),
      files: [
        source("src/first.ts", "export function firstFeature() { return true; }\n"),
        source("src/second.ts", "export function secondFeature() { return true; }\n"),
      ],
      inputLimits: { maxFiles: 1 },
      contextLines: 0,
    });

    expect(diagnosticCodes(result)).toContain("max_files_exceeded");
    expect(result.includedSymbols.map((symbol) => symbol.tag.name)).toContain("firstFeature");
    expect(result.includedSymbols.map((symbol) => symbol.tag.name)).not.toContain("secondFeature");
    expect(result.excludedFiles).toContainEqual(expect.objectContaining({
      file: "src/second.ts",
      reason: "diagnostic",
    }));
  });

  it("skips binary, generated, and unsupported source candidates", async () => {
    const result = await buildBudgetedAgentMapResult({
      request: buildHardeningRequest([
        "src/client.generated.ts",
        "src/blob.ts",
        "docs/readme.md",
        "src/ok.ts",
      ], {
        mentionedSymbols: ["okFeature"],
      }),
      files: [
        source("src/client.generated.ts", "export function generatedFeature() { return true; }\n"),
        source("src/blob.ts", "\u0000\u0001export function binaryFeature() { return true; }\n"),
        source("docs/readme.md", "# AgentMap fixture\n"),
        source("src/ok.ts", "export function okFeature() { return true; }\n"),
      ],
      contextLines: 0,
    });

    expect(diagnosticCodes(result)).toEqual(expect.arrayContaining([
      "binary_file",
      "generated_file",
      "unsupported_extension",
    ]));
    expect(result.includedSymbols.map((symbol) => symbol.tag.name)).toContain("okFeature");
    expect(result.includedSymbols.map((symbol) => symbol.tag.name)).not.toEqual(expect.arrayContaining([
      "generatedFeature",
      "binaryFeature",
    ]));
  });

  it("isolates a single file parse failure without failing the result", async () => {
    const createSourceFile = ((...args: Parameters<typeof ts.createSourceFile>) => {
      const [fileName] = args;
      if (String(fileName).includes("broken.ts")) {
        throw new Error("fixture parse failure");
      }
      return ts.createSourceFile(...args);
    }) as typeof ts.createSourceFile;
    const runtime = Object.assign(Object.create(ts) as typeof import("typescript"), {
      createSourceFile,
    });
    agentMapInternalsForTest.setTypeScriptRuntimeForTest(runtime);

    const result = await buildBudgetedAgentMapResult({
      request: buildHardeningRequest(["src/good.ts", "src/broken.ts"], {
        mentionedSymbols: ["goodFeature"],
      }),
      files: [
        source("src/good.ts", "export function goodFeature() { return true; }\n"),
        source("src/broken.ts", "export function brokenFeature() { return true; }\n"),
      ],
      contextLines: 0,
    });

    expect(result.status).toBe("success");
    expect(diagnosticCodes(result)).toContain("parse_failure");
    expect(result.includedSymbols.map((symbol) => symbol.tag.name)).toContain("goodFeature");
    expect(result.excludedFiles).toContainEqual(expect.objectContaining({
      file: "src/broken.ts",
      reason: "diagnostic",
    }));
  });

  it("returns structured empty status when filters remove every candidate", async () => {
    const result = await buildBudgetedAgentMapResult({
      request: buildHardeningRequest(["README.md"]),
      files: [source("README.md", "# No supported AgentMap source\n")],
      contextLines: 0,
    });

    expect(result.status).toBe("empty");
    expect(result.content).toBe("");
    expect(diagnosticCodes(result)).toEqual(expect.arrayContaining([
      "unsupported_extension",
      "empty_candidate_set",
    ]));
    expect(result.evidence).toContainEqual(expect.objectContaining({
      type: "diagnostic",
      metadata: expect.objectContaining({
        diagnosticCodes: expect.arrayContaining(["empty_candidate_set"]),
      }),
    }));
    expect(isAgentMapResult(result)).toBe(true);
  });

  it("keeps readonly result and diagnostic schemas legal with hardening metadata", async () => {
    const result = await buildBudgetedAgentMapResult({
      request: buildHardeningRequest(["src/ok.ts", "dist/generated.ts"], {
        mentionedSymbols: ["okFeature"],
      }),
      files: [
        source("src/ok.ts", "export function okFeature() { return true; }\n"),
        source("dist/generated.ts", "export function ignoredFeature() { return true; }\n"),
      ],
      contextLines: 0,
    });

    expect(result.readonly).toBe(true);
    expect(isAgentMapResult(result)).toBe(true);
    expect(result.diagnostics?.every(isAgentMapDiagnostic)).toBe(true);
    expect(result.metadata).toMatchObject({
      readonlyOnly: true,
      diagnosticCount: 1,
    });
  });
});

function buildHardeningRequest(
  candidateFiles: string[],
  overrides: Partial<AgentMapRequest> = {},
): AgentMapRequest {
  return buildAgentMapRequestFixture({
    activeFiles: [],
    candidateFiles,
    mentionedFiles: [],
    mentionedSymbols: [],
    promptPresentFiles: [],
    tokenBudget: 700,
    refreshPolicy: "force",
    ...overrides,
  });
}

function source(file: string, content: string): AgentMapSourceFile {
  return { file, content };
}

function diagnosticCodes(result: AgentMapResult): AgentMapDiagnosticCode[] {
  return result.diagnostics?.map((diagnostic) => diagnostic.code) ?? [];
}
