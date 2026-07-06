import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_FAILURE_PASSIVE_SHADOW_ADVISORY_ONLY,
  RUNTIME_FAILURE_PASSIVE_SHADOW_SUMMARY_MAX_CHARS,
  classifyRuntimeFailurePassiveShadow,
  validateFailureEvent,
  type FailureEvent,
  type RuntimeFailurePassiveClassifierInput,
} from "../../openclaw_runtime/src/runtime-core";

function classify(
  overrides: Partial<RuntimeFailurePassiveClassifierInput>,
): FailureEvent {
  return classifyRuntimeFailurePassiveShadow({
    id: "failure-1",
    source: "runtime-failure-intelligence-passive-shadow-test",
    occurredAt: "2026-07-01T12:00:00.000Z",
    signal: "unknown failure",
    ...overrides,
  });
}

function expectValidFailureEvent(event: FailureEvent): void {
  const result = validateFailureEvent(event);
  expect(result.ok).toBe(true);
}

describe("runtime failure intelligence passive shadow classifier", () => {
  it("accepts a representative tool error", () => {
    const event = classify({
      id: "tool-permission",
      signal: {
        stage: "tool_call",
        code: "EACCES",
        toolName: "shell_command",
        message: "Permission denied while running command.",
        exitCode: 1,
      },
      evidenceRefs: ["tool-run-1"],
    });

    expect(event).toMatchObject({
      stage: "tool_call",
      kind: "permission",
      recoverability: "ask_user",
      suggestedAction: "ask_user",
      rawRetained: false,
      redaction: "sanitized",
    });
    expect(event.summary).toContain("Passive advisory");
    expectValidFailureEvent(event);
  });

  it("accepts a test failure", () => {
    const event = classify({
      id: "test-failure",
      source: "vitest",
      signal: {
        message: "Vitest assertion failed: expected 200 received 500.",
        status: "failed",
      },
    });

    expect(event.stage).toBe("test");
    expect(event.kind).toBe("test_failure");
    expect(event.suggestedAction).toBe("continue_with_caution");
    expectValidFailureEvent(event);
  });

  it("accepts a provider timeout", () => {
    const event = classify({
      id: "provider-timeout",
      source: "provider.openai",
      signal: {
        timedOut: true,
        message: "OpenAI provider request timed out before completion.",
        statusCode: 504,
      },
    });

    expect(event.stage).toBe("provider");
    expect(event.kind).toBe("timeout");
    expect(event.recoverability).toBe("retryable");
    expect(event.suggestedAction).toBe("retry");
    expectValidFailureEvent(event);
  });

  it("accepts a gateway error", () => {
    const event = classify({
      id: "gateway-error",
      source: "gateway.httpProxy",
      signal: {
        message: "Gateway http proxy returned 502 for session send.",
        statusCode: 502,
      },
    });

    expect(event.stage).toBe("gateway");
    expect(event.kind).toBe("gateway_error");
    expect(event.suggestedAction).toBe("retry");
    expectValidFailureEvent(event);
  });

  it("accepts a user interruption", () => {
    const event = classify({
      id: "user-interrupt",
      signal: {
        interrupted: true,
        message: "Task was cancelled by user before completion.",
      },
    });

    expect(event.stage).toBe("user_interrupt");
    expect(event.kind).toBe("unknown");
    expect(event.recoverability).toBe("non_recoverable");
    expect(event.suggestedAction).toBe("stop");
    expectValidFailureEvent(event);
  });

  it("sanitizes secret-like content out of bounded summaries", () => {
    const event = classify({
      id: "secret-redaction",
      signal: {
        message: [
          "Provider payload failed with api_key=sk-thisShouldNotSurvive1234567890",
          "PASSWORD=hunter2",
          "workspace C:\\Users\\someone\\project\\private-file.ts",
          "{\"prompt\":\"raw user prompt\",\"toolArgs\":{\"secret\":\"abc\"}}",
        ].join(" "),
      },
    });

    expect(event.summary.length).toBeLessThanOrEqual(RUNTIME_FAILURE_PASSIVE_SHADOW_SUMMARY_MAX_CHARS);
    expect(event.summary).not.toContain("sk-thisShouldNotSurvive");
    expect(event.summary).not.toContain("hunter2");
    expect(event.summary).not.toContain("private-file.ts");
    expect(event.summary).not.toContain("raw user prompt");
    expect(event.summary).toContain("[redacted");
    expectValidFailureEvent(event);
  });

  it("falls back to stable unknown classification for unknown signals", () => {
    const event = classify({
      id: "unknown-signal",
      signal: {
        message: "",
        status: "mystery",
      },
    });

    expect(event).toMatchObject({
      stage: "unknown",
      kind: "unknown",
      recoverability: "unknown",
      suggestedAction: "continue_with_caution",
      confidence: 0.2,
    });
    expect(event.summary).toContain("stage=unknown");
    expectValidFailureEvent(event);
  });

  it("keeps suggested actions advisory-only", () => {
    const event = classify({
      id: "advisory-proof",
      signal: {
        stage: "provider",
        kind: "provider_error",
        message: "Provider returned a rate limit error.",
      },
    });

    expect(RUNTIME_FAILURE_PASSIVE_SHADOW_ADVISORY_ONLY).toBe(true);
    expect(event.suggestedAction).toBe("degrade");
    expect(event.summary).toContain("advisory");
    expectValidFailureEvent(event);
  });

  it("does not introduce an active runtime consumer", () => {
    const forbiddenRoots = [
      "openclaw_runtime/src/agents",
      "openclaw_runtime/src/gateway",
      "openclaw_runtime/src/acp",
      "electron/services",
      "electron/main",
      "src",
    ];
    const hits = forbiddenRoots.flatMap((root) => sourceHits(root, [
      "failure-intelligence-passive-shadow",
      "classifyRuntimeFailurePassiveShadow",
    ]));

    expect(hits).toEqual([]);
  });
});

function sourceHits(root: string, needles: string[]): string[] {
  const absoluteRoot = join(process.cwd(), root);
  if (!existsSync(absoluteRoot)) {
    return [];
  }
  return collectSourceFiles(absoluteRoot).flatMap((file) => {
    const content = readFileSync(file, "utf8");
    return needles.some((needle) => content.includes(needle))
      ? [file.replace(process.cwd(), "").replace(/^[\\/]/, "")]
      : [];
  });
}

function collectSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = join(root, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", ".git"].includes(entry.name)) {
        return [];
      }
      return collectSourceFiles(child);
    }
    return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [child] : [];
  });
}
