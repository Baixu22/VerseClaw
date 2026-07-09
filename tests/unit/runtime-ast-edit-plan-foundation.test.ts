import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  editPlanFromReadonlyAstPatchPlannerScan,
  type AstPatchPlannerReadonlyScanResult,
} from "../../openclaw_runtime/src/runtime-core";
import {
  eventBus,
  evidenceLedger,
  lifecycleEngine,
} from "../../openclaw_runtime/src/runtime-spine";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readonlyScanFixture(filePath = "src/example.ts"): AstPatchPlannerReadonlyScanResult {
  const source = "const value = 1;\n";
  const replacement = "const value = 2;\n";
  const range = {
    start: 0,
    end: source.length,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: source.length + 1,
  };
  const evidenceRefs = [
    {
      type: "file" as const,
      ref: filePath,
      label: "readonly scan fixture",
    },
  ];

  return {
    schemaVersion: 1,
    source: "runtime.ast_patch_planner.readonly_scan",
    status: "success",
    mode: "readonly_scan",
    flags: { readonlyScan: true, previewDiff: true },
    authority: {
      diagnosticsOnly: true,
      readonly: true,
      noPatchApply: true,
      noWorkspaceMutation: true,
      noSymbolMutation: true,
      noTaskLoopInvocation: true,
      noGatewayIntegration: true,
      noProviderTransportChange: true,
      previewDiffOnly: true,
      previewDiffIsNotCompletionEvidence: true,
    },
    validation: {
      status: "accepted",
      ruleHash: digest("rule"),
      language: "typescript",
      patternMetavariables: [],
      fixMetavariables: [],
      diagnostics: [],
      evidenceRefs,
    },
    matches: [
      {
        matchId: "match-1",
        filePath,
        language: "typescript",
        astKind: "SourceFile",
        range,
        excerpt: source,
        excerptHash: digest(source),
        metavariables: {},
        replacementPreview: replacement,
        replacementHash: digest(replacement),
        evidenceRefs,
      },
    ],
    previewDiff: {
      text: "-const value = 1;\n+const value = 2;\n",
      hash: digest("preview"),
      fullByteLength: 34,
      truncated: false,
      files: [
        {
          filePath,
          diffHash: digest("preview:file"),
          byteLength: 34,
          previewText: "-const value = 1;\n+const value = 2;\n",
          previewTextByteLength: 34,
          truncated: false,
          replacementCount: 1,
        },
      ],
    },
    checkpoint: {
      schemaVersion: 1,
      ruleHash: digest("rule"),
      targetFiles: [{ filePath, language: "typescript", sourceHash: digest(source) }],
      matchCount: 1,
      matchRanges: [
        {
          matchId: "match-1",
          filePath,
          start: range.start,
          end: range.end,
          excerptHash: digest(source),
          replacementHash: digest(replacement),
        },
      ],
      previewDiffHash: digest("preview"),
      sourceFileHashes: { [filePath]: digest(source) },
    },
    diagnostics: [],
    evidenceRefs,
  };
}

describe("AST EditPlan runtime spine foundation", () => {
  it("creates an ast_edit_plan entity, scan evidence, and plan lifecycle events", () => {
    eventBus.clear();

    const plan = editPlanFromReadonlyAstPatchPlannerScan(readonlyScanFixture());

    const entity = lifecycleEngine
      .getByType("ast_edit_plan")
      .find((candidate) => candidate.metadata?.planId === plan.planId);
    expect(entity).toBeDefined();
    expect(entity?.phase).toBe("planned");

    const events = eventBus.getByEntity(entity!.entityId);
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["ast.plan_created", "ast.scanned"]),
    );
    expect(events.find((event) => event.kind === "ast.scanned")?.payload).toMatchObject({
      evidenceKind: "scan_evidence",
      scanStatus: "success",
    });

    const evidence = evidenceLedger.getByEntity(entity!.entityId);
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "diagnostic_snapshot",
          collector: "runtime.ast_edit_plan.scan",
          metadata: expect.objectContaining({ evidenceKind: "scan_evidence" }),
        }),
      ]),
    );
    expect(evidence.some((item) => item.kind === "completion_evidence")).toBe(false);
  });
});
