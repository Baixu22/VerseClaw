import { describe, expect, it } from "vitest";
import { projectChatDisplayMessages } from "./chat-display-projection.js";

function mutationDetails(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    patchArtifacts: [{
      schema: "GitPatchArtifact/v1",
      file: "src/example.ts",
      status: "modified",
      contentKind: "text",
      hunks: [{
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { kind: "deletion", text: "const value = 1", oldLine: 1, newLine: null },
          { kind: "addition", text: "const value = 2", oldLine: null, newLine: 1 },
        ],
      }],
      patch: "--- src/example.ts\n+++ src/example.ts\n@@ -1 +1 @@\n-const value = 1\n+const value = 2",
      completeness: "complete",
      lineage: {
        requestId: "call-1",
        journalEntryId: "write-journal:session:1",
      },
    }],
    write_journal: {
      undoable: true,
      snapshots: [{
        seq: 1,
        journalEntryId: "write-journal:session:1",
        path: "src/example.ts",
        hadPrior: true,
        snapshotPath: "C:/secret/snapshot.pre",
      }],
    },
    working_memory: { result_summary: "must not cross the display boundary" },
    ...overrides,
  };
}

function validVerifyDetails(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    detected: true,
    ecosystem: "node",
    runner: "npm",
    command: "npm test",
    evidence: "package.json",
    workdir: ".",
    execution: {
      status: "passed",
      command: "npm test",
      workdir: ".",
      exitCode: 0,
      durationMs: 25,
      outputTail: "AUTO_VERIFY_PASS",
    },
    rendered: "passed(node/npm): npm test [cwd=.; exit=0; 25ms]",
    ...overrides,
  };
}

function projectToolResult(details: Record<string, unknown>) {
  const projected = projectChatDisplayMessages([
    {
      role: "assistant",
      content: [{
        type: "toolCall",
        id: "call-1",
        name: "edit",
        input: { path: "src/example.ts" },
      }],
    },
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "edit",
      content: [{ type: "text", text: "Successfully edited src/example.ts" }],
      details,
    },
  ], { maxChars: 500_000, stripEnvelope: false });
  return projected.find((message) => String(message.role).toLowerCase() === "toolresult");
}

describe("chat display mutation patch projection", () => {
  it("preserves only the bounded strict artifact and journal lineage", () => {
    const result = projectToolResult(mutationDetails());

    expect(result?.details).toMatchObject({
      patchArtifacts: [{
        schema: "GitPatchArtifact/v1",
        file: "src/example.ts",
        lineage: {
          requestId: "call-1",
          journalEntryId: "write-journal:session:1",
        },
      }],
      write_journal: {
        undoable: true,
        snapshots: [{
          seq: 1,
          path: "src/example.ts",
          journalEntryId: "write-journal:session:1",
          hadPrior: true,
        }],
      },
    });
    expect(result?.details).not.toHaveProperty("working_memory");
    expect(result?.details).not.toHaveProperty("write_journal.snapshots.0.snapshotPath");
  });

  it("preserves a strict verify outcome while stripping unrelated fields", () => {
    const result = projectToolResult(mutationDetails({
      verify_tests: validVerifyDetails({
        apiKey: "secret-at-top-level",
        execution: {
          ...(validVerifyDetails().execution as Record<string, unknown>),
          approvalId: "approval-secret",
          aggregated: "raw-unbounded-output",
        },
      }),
    }));

    expect(result?.details).toMatchObject({
      verify_tests: {
        detected: true,
        ecosystem: "node",
        runner: "npm",
        command: "npm test",
        evidence: "package.json",
        workdir: ".",
        execution: {
          status: "passed",
          command: "npm test",
          workdir: ".",
          exitCode: 0,
          durationMs: 25,
          outputTail: "AUTO_VERIFY_PASS",
        },
      },
    });
    expect(result?.details).not.toHaveProperty("verify_tests.apiKey");
    expect(result?.details).not.toHaveProperty("verify_tests.execution.approvalId");
    expect(result?.details).not.toHaveProperty("verify_tests.execution.aggregated");
  });

  it("bounds verify display strings and keeps the tail of runner output", () => {
    const marker = "AUTO_VERIFY_LAST_LINE";
    const oversized = `${"x".repeat(4_000)}${marker}`;
    const result = projectToolResult(mutationDetails({
      verify_tests: validVerifyDetails({
        rendered: "r".repeat(5_000),
        execution: {
          ...(validVerifyDetails().execution as Record<string, unknown>),
          reason: "reason ".repeat(500),
          outputTail: oversized,
        },
      }),
    }));
    const verify = (result?.details as Record<string, unknown>)?.verify_tests as Record<string, unknown>;
    const execution = verify.execution as Record<string, unknown>;

    expect(String(verify.rendered).length).toBeLessThanOrEqual(3_000);
    expect(String(execution.reason).length).toBeLessThanOrEqual(2_000);
    expect(String(execution.outputTail).length).toBeLessThanOrEqual(2_400);
    expect(String(execution.outputTail)).toContain("...(truncated)...");
    expect(String(execution.outputTail)).toContain(marker);
  });

  it.each([
    ["unknown status", validVerifyDetails({
      execution: {
        ...(validVerifyDetails().execution as Record<string, unknown>),
        status: "mystery",
      },
    })],
    ["malformed execution", validVerifyDetails({ execution: ["not-an-object"] })],
    ["absolute workdir", validVerifyDetails({
      workdir: "C:/secret/workspace",
      execution: {
        ...(validVerifyDetails().execution as Record<string, unknown>),
        workdir: "C:/secret/workspace",
      },
    })],
    ["unknown skip reason", {
      detected: false,
      skipReason: "unknown",
      message: "not safe",
      rendered: "skipped(unknown)",
    }],
  ])("drops malformed verify data for %s while preserving patch lineage", (_label, verifyTests) => {
    const result = projectToolResult(mutationDetails({ verify_tests: verifyTests }));

    expect(result?.details).not.toHaveProperty("verify_tests");
    expect(result?.details).toMatchObject({
      patchArtifacts: [{ lineage: { requestId: "call-1" } }],
      write_journal: { snapshots: [{ journalEntryId: "write-journal:session:1" }] },
    });
  });

  it("preserves a strict explainable skip without inventing an execution", () => {
    const result = projectToolResult(mutationDetails({
      verify_tests: {
        detected: false,
        skipReason: "no-manifest",
        message: "No project manifest was found; no test suite was run.",
        rendered: "skipped(no-manifest): No project manifest was found; no test suite was run.",
      },
    }));

    expect(result?.details).toHaveProperty("verify_tests", {
      detected: false,
      skipReason: "no-manifest",
      message: "No project manifest was found; no test suite was run.",
      rendered: "skipped(no-manifest): No project manifest was found; no test suite was run.",
    });
  });

  it.each([
    ["stale request", mutationDetails({
      patchArtifacts: [{
        ...(mutationDetails().patchArtifacts as Array<Record<string, unknown>>)[0],
        lineage: { requestId: "stale", journalEntryId: "write-journal:session:1" },
      }],
    })],
    ["missing journal", mutationDetails({ write_journal: { undoable: true, snapshots: [] } })],
    [
      "producer error",
      mutationDetails({
        patchArtifactError: {
          schema: "RemoteForgeError/v1",
          code: "incomplete_response",
          retryable: false,
          requestId: "call-1",
          safeMessage: "The response is incomplete and cannot be used safely.",
        },
      }),
    ],
    ["unknown schema", mutationDetails({
      patchArtifacts: [{
        ...(mutationDetails().patchArtifacts as Array<Record<string, unknown>>)[0],
        schema: "GitPatchArtifact/v2",
      }],
    })],
  ])("drops all structured details for %s", (_label, details) => {
    expect(projectToolResult(details)?.details).toBeUndefined();
  });

  it("continues to strip unrelated tool details", () => {
    const projected = projectChatDisplayMessages([{
      role: "toolResult",
      toolCallId: "read-1",
      toolName: "read",
      content: [{ type: "text", text: "read ok" }],
      details: { absolutePath: "C:/secret/file.txt" },
    }], { stripEnvelope: false });

    expect(projected[0]?.details).toBeUndefined();
  });
});
