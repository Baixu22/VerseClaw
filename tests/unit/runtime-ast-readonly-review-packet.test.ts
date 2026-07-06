import { describe, expect, it } from "vitest";
import {
  buildAstReadonlyReviewPacket,
  type AstGrepEditPlanTargetFile,
} from "../../openclaw_runtime/src/runtime-core";

describe("AST readonly runtime review packet", () => {
  it("builds an explicit internal review packet with batched readonly candidates", () => {
    const packet = buildAstReadonlyReviewPacket({
      scenarioId: "api_rename",
      rule: {
        language: "typescript",
        pattern: "oldApi($VALUE)",
        fix: "newApi($VALUE)",
      },
      targetFiles: repeatedCallTargets("src/runtime-review/api", 5),
      maxMatchesPerBatch: 2,
    });

    expect(packet.status).toBe("ready_for_internal_review");
    expect(packet.batchCount).toBe(3);
    expect(packet.targetFileCount).toBe(5);
    expect(packet.candidateOperationCount).toBe(5);
    expect(packet.allowedNextStep).toBe("human_review_packet");
    expect(packet.evidenceQuality).toMatchObject({
      explicitTargetCoverageRate: 1,
      batchCompletenessRate: 1,
      authorityClean: true,
      reviewPacketComplete: true,
    });
    expect(packet.positioning).toMatchObject({
      explicitInvocationOnly: true,
      internalReviewOnly: true,
      readonly: true,
      planningOnly: true,
      noPatchApply: true,
      noWorkspaceMutation: true,
      noSymbolMutation: true,
      noTaskLoopInvocation: true,
      noGatewayIntegration: true,
      noProviderTransportChange: true,
      noPromptOrModelMessageInsertion: true,
      noPersistence: true,
      noDefaultOnBehavior: true,
      notRuntimeDecisionInput: true,
    });
  });

  it("holds route boundary candidates until contract owner evidence is explicit", () => {
    const packet = buildAstReadonlyReviewPacket({
      scenarioId: "ipc_host_api_route_rename",
      rule: {
        language: "typescript",
        pattern: 'ipcRenderer.invoke("old-route", $PAYLOAD)',
        fix: 'ipcRenderer.invoke("new-route", $PAYLOAD)',
      },
      targetFiles: [
        target(
          "electron/main/route-review.ts",
          [
            "export function send(payload: unknown) {",
            '  return ipcRenderer.invoke("old-route", payload);',
            "}",
          ].join("\n"),
        ),
      ],
    });

    expect(packet.status).toBe("held_for_contract_review");
    expect(packet.allowedNextStep).toBe("contract_owner_review");
    expect(packet.candidateOperationCount).toBe(1);
    expect(packet.semanticPrecheck).toEqual({
      status: "contract_review_required",
      reasons: ["route_literal_detected", "contract_owner_evidence_required"],
    });
    expect(packet.failureResponse).toMatchObject({
      trigger: "route_contract_gap",
    });
  });

  it("fails closed for invalid rules without candidate operations", () => {
    const packet = buildAstReadonlyReviewPacket({
      scenarioId: "api_rename",
      rule: {
        language: "typescript",
        pattern: "$ANY",
        fix: "$ANY",
      },
      targetFiles: [target("src/invalid.ts", "const value = oldApi(input);")],
    });

    expect(packet.status).toBe("invalid");
    expect(packet.allowedNextStep).toBe("fix_rule_or_input");
    expect(packet.candidateOperationCount).toBe(0);
    expect(packet.diagnostics).toContain("overbroad_pattern");
    expect(packet.evidenceQuality).toMatchObject({
      failClosed: true,
      authorityClean: true,
      reviewPacketComplete: false,
    });
    expect(packet.failureResponse).toMatchObject({
      trigger: "invalid_rule_or_input",
    });
  });
});

function repeatedCallTargets(prefix: string, count: number): AstGrepEditPlanTargetFile[] {
  return Array.from({ length: count }, (_, index) =>
    target(`${prefix}-${index}.ts`, `export const value${index} = oldApi(input${index});`)
  );
}

function target(filePath: string, content: string): AstGrepEditPlanTargetFile {
  return { filePath, content };
}
