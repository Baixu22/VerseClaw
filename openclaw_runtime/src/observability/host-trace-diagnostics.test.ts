import { describe, expect, it } from "vitest";
import {
  classifyTraceFailure,
  createHostTraceDiagnosticsAuthority,
  suggestedActionForTraceFailure,
  type HostTraceLineageInput,
} from "./host-trace-diagnostics.js";

const SECRET = new Uint8Array(32).fill(7);
const LINEAGE: HostTraceLineageInput = {
  requestId: "req-verseshell-1",
  traceId: "1".repeat(32),
  spanId: "2".repeat(16),
  parentTraceId: "3".repeat(32),
  runId: "run-verseshell-1",
  correlationDigest: "a".repeat(64),
};

function authority(now = 1_700_000_000_000) {
  return createHostTraceDiagnosticsAuthority(SECRET, { now: () => now });
}

describe("host trace diagnostics contract", () => {
  it("issues a signed, bounded envelope from host lineage only", () => {
    const issuer = authority();
    const envelope = issuer.issue(LINEAGE);

    expect(envelope.signature).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
    expect(issuer.verify(envelope)).toEqual(envelope);
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.lineage)).toBe(true);
    expect("command" in envelope).toBe(false);
  });

  it.each([
    ["requestId", { ...LINEAGE, requestId: undefined }],
    ["traceId", { ...LINEAGE, traceId: undefined }],
    ["spanId", { ...LINEAGE, spanId: undefined }],
    ["parentTraceId", { ...LINEAGE, parentTraceId: "not-a-trace-id" }],
  ])("rejects incomplete or invalid %s lineage", (_field, input) => {
    expect(() => authority().issue(input as unknown as HostTraceLineageInput)).toThrow(TypeError);
  });

  it("rejects raw fields at the trace boundary and rejects tampering or another host key", () => {
    const issuer = authority();
    const envelope = issuer.issue(LINEAGE);
    const withRawField = { ...LINEAGE, command: "pnpm test --token super-secret" };
    expect(() => issuer.issue(withRawField as unknown as HostTraceLineageInput)).toThrow(TypeError);

    const tampered = {
      ...envelope,
      lineage: { ...envelope.lineage, traceId: "4".repeat(32) },
    };
    expect(issuer.verify(tampered)).toBeUndefined();
    expect(createHostTraceDiagnosticsAuthority(new Uint8Array(32).fill(8)).verify(envelope)).toBeUndefined();
  });

  it("fails closed for missing or expired lineage before making a summary", () => {
    const clock = { value: 1_700_000_000_000 };
    const issuer = createHostTraceDiagnosticsAuthority(SECRET, {
      now: () => clock.value,
      ttlMs: 1_000,
    });
    const envelope = issuer.issue(LINEAGE);

    expect(issuer.summarize({ ...envelope, signature: "hmac-sha256:" + "0".repeat(64) }, {})).toBeUndefined();
    clock.value += 1_000;
    expect(issuer.verify(envelope)).toBeUndefined();
    expect(issuer.summarize(envelope, { code: "COMPILE_FAILED" })).toBeUndefined();
  });

  it.each([
    [{ code: "COMPILE_FAILED" }, "compile"],
    [{ phase: "test", exitCode: 1 }, "test"],
    [{ code: "ENOENT", message: "spawn pnpm ENOENT" }, "tool_missing"],
    [{ code: "EACCES", message: "permission denied" }, "permission"],
    [{ code: "INVALID_CWD" }, "environment"],
    [{ code: "RUNTIME_ERROR" }, "runtime"],
  ] as const)("classifies %j as %s", (evidence, expected) => {
    expect(classifyTraceFailure(evidence)).toBe(expected);
  });

  it.each([
    ["compile", "continue_with_caution"],
    ["test", "continue_with_caution"],
    ["tool_missing", "ask_user"],
    ["permission", "ask_user"],
    ["environment", "ask_user"],
    ["runtime", "retry"],
    ["timeout", "retry"],
    ["cancelled", "stop"],
    ["unknown", "continue_with_caution"],
  ] as const)("maps %s to a fixed suggested action", (kind, action) => {
    expect(suggestedActionForTraceFailure(kind)).toBe(action);
  });

  it("classifies transport-independent timeout, cancellation, and unknown failures", () => {
    expect(classifyTraceFailure({ timedOut: true, message: "raw command output" })).toBe("timeout");
    expect(classifyTraceFailure({ cancelled: true, message: "prompt text" })).toBe("cancelled");
    expect(classifyTraceFailure({ message: "an unrecognized failure" })).toBe("unknown");
  });

  it("returns only bounded trace and taxonomy fields, never sensitive evidence", () => {
    const issuer = authority();
    const envelope = issuer.issue(LINEAGE);
    const sensitive = {
      code: "COMPILE_FAILED",
      message: "pnpm test --token super-secret; prompt=private prompt; output=private output",
      command: "pnpm test --token super-secret",
      prompt: "private prompt",
      output: "private output",
      secret: "super-secret",
      durationMs: 123,
      exitCode: 1,
      signal: "SIGTERM",
    };

    const summary = issuer.summarize(envelope, sensitive);
    expect(summary).toEqual({
      schemaVersion: "1",
      trace: LINEAGE,
      failureKind: "compile",
      suggestedAction: "continue_with_caution",
      durationMs: 123,
      exitCode: 1,
      signal: "sigterm",
      redaction: "raw-fields-omitted",
    });
    const serialized = JSON.stringify(summary);
    for (const value of [sensitive.message, sensitive.command, sensitive.prompt, sensitive.output, sensitive.secret]) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toContain("command");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("output");
    expect(serialized).not.toContain("secret");
  });
});
