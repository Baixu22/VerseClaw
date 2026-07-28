import { describe, expect, it, vi } from "vitest";

import {
  VERSESHELL_FOUNDATION_KILL_SWITCH_ENV,
  resolveVerseShellFoundationRollout,
} from "./verseshell-foundation-flags.js";
import {
  VERSESHELL_FOUNDATION_SHADOW_OPS,
  compareVerseShellFoundationShadow,
  planVerseShellFoundationReadOnlyShadow,
} from "./verseshell-foundation-shadow-evidence.js";
import { VerseShellFoundationTelemetryRecorder } from "./verseshell-foundation-telemetry.js";

describe("VerseShell foundation rollout", () => {
  it("resolves deterministic canary-safe defaults", () => {
    const first = resolveVerseShellFoundationRollout({ env: {} });
    const second = resolveVerseShellFoundationRollout({ env: {} });

    expect(first).toEqual(second);
    expect(Object.values(first.enabled).every((enabled) => enabled === false)).toBe(true);
    expect(first.governedExecNativeFallback).toBe(false);
    expect(first.shadowAccess).toBe("disabled");
    expect(Object.values(first.flags).every((flag) => flag.source === "default")).toBe(true);
  });

  it("keeps independent provenance and honors fail-closed kill switches", () => {
    const resolved = resolveVerseShellFoundationRollout({
      config: { runtime: { verseShellFoundation: { typedAci: true, governedExec: false } } },
      env: { VERSE_VERSESHELL_FOUNDATION_FACADE: "true" },
    });
    expect(resolved.flags.typedAci).toMatchObject({ enabled: true, source: "config" });
    expect(resolved.flags.facade).toMatchObject({ enabled: true, source: "environment" });
    expect(resolved.flags.governedExec).toMatchObject({ enabled: false, source: "config" });
    expect(resolved.flags.artifactResults.enabled).toBe(false);

    const killed = resolveVerseShellFoundationRollout({
      config: { typedAci: true },
      env: { [VERSESHELL_FOUNDATION_KILL_SWITCH_ENV]: "on" },
    });
    expect(killed.killSwitch.engaged).toBe(true);
    expect(Object.values(killed.enabled).every((enabled) => enabled === false)).toBe(true);
    expect(Object.values(killed.flags).every((flag) => flag.source === "kill-switch")).toBe(true);

    const failedAuthority = resolveVerseShellFoundationRollout({
      config: { typedAci: true },
      env: {},
      globalKillSwitch: () => {
        throw new Error("authority unavailable");
      },
    });
    expect(failedAuthority.killSwitch.engaged).toBe(true);
    expect(failedAuthority.enabled.typedAci).toBe(false);
  });
});

describe("VerseShell foundation read-only shadow evidence", () => {
  it("permits only the strict read-only operation allowlist", () => {
    for (const operation of VERSESHELL_FOUNDATION_SHADOW_OPS) {
      expect(planVerseShellFoundationReadOnlyShadow({ operation }).access).toBe("read-only");
    }
    for (const operation of [
      "file.write",
      "file.delete",
      "repo.apply_patch",
      "exec.run",
      "network.fetch",
      "tx.begin",
      "tx.commit",
      "test.run",
      "ops.invoke",
    ]) {
      expect(planVerseShellFoundationReadOnlyShadow({ operation })).toMatchObject({
        eligible: false,
        access: "none",
      });
    }
  });

  it("normalizes paths and ignores prose while comparing structured semantics", () => {
    const evidence = compareVerseShellFoundationShadow({
      operation: "file.view",
      expected: {
        ok: true,
        paths: ["C:\\Work\\repo\\src\\a.ts"],
        data: { file_path: "C:\\Work\\repo\\src\\a.ts", count: 2 },
        diagnostics: [{ code: "READ_OK", message: "native prose" }],
        effects: ["read"],
        capabilities: ["filesystem.read"],
        artifacts: [{ mediaType: "text/plain", sizeBytes: 10, sha256: "ABCD" }],
        approvalState: "not-required",
        prose: "Native result wording",
      },
      actual: {
        ok: true,
        paths: ["c:/Work/repo/src/a.ts"],
        data: { count: 2, file_path: "c:/Work/repo/src/a.ts" },
        diagnostics: [{ code: "READ_OK", message: "different VerseShell prose" }],
        effects: ["read"],
        capabilities: ["filesystem.read"],
        artifacts: [{ sha256: "abcd", sizeBytes: 10, mediaType: "text/plain" }],
        approvalState: "not-required",
        prose: "Different prose",
      },
    });
    expect(evidence.match).toBe(true);
    expect(evidence.mismatches).toEqual([]);
    expect(evidence.comparedFields).not.toContain("prose");
  });

  it("bounds evidence and never emits arguments, content, or secrets", () => {
    const secret = "sk-super-secret-value";
    const plan = planVerseShellFoundationReadOnlyShadow({
      operation: "repo.search",
      args: { query: secret, authorization: secret, content: "x".repeat(20_000) },
    });
    expect(JSON.stringify(plan)).not.toContain(secret);
    expect(JSON.stringify(plan)).not.toContain("x".repeat(100));

    const evidence = compareVerseShellFoundationShadow({
      operation: "repo.search",
      expected: {
        ok: false,
        errorCode: "DENIED",
        data: Object.fromEntries(
          Array.from({ length: 300 }, (_, index) => [`secret_${index}`, `${secret}-${index}`]),
        ),
        diagnostics: Array.from({ length: 100 }, (_, index) => ({
          code: `E_${index}`,
          message: `${secret}-${"x".repeat(1000)}`,
        })),
      },
      actual: { ok: true, data: { content: secret } },
      maxEvidenceBytes: 512,
      maxMismatches: 2,
    });
    const serialized = JSON.stringify(evidence);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(640);
    expect(evidence.mismatches.length).toBeLessThanOrEqual(2);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("message");
  });
});

describe("VerseShell foundation telemetry", () => {
  it("records bounded deterministic metrics with stable ordering", () => {
    const sink = vi.fn();
    const recorder = new VerseShellFoundationTelemetryRecorder({
      maxEvents: 2,
      now: () => 100,
      sink,
    });
    recorder.record({ type: "process.lifecycle", action: "start", processVersion: "1.0.0" });
    recorder.record({
      type: "operation.completed",
      operation: "file.view",
      latencyMs: 5,
      outcome: "ok",
      effect: "read",
      capabilityDecision: "allow",
    });
    recorder.record({
      type: "tools.surface",
      visibleCount: 3,
      deferredCount: 7,
      schemaBytes: 4096,
    });

    const snapshot = recorder.snapshot();
    expect(snapshot.recordedEvents).toBe(2);
    expect(snapshot.droppedEvents).toBe(1);
    expect(snapshot.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(Object.keys(snapshot.metrics)).toEqual(Object.keys(snapshot.metrics).sort());
    expect(snapshot.metrics).toMatchObject({
      "events.dropped": 1,
      "operation.effect.read": 1,
      "operation.latency_ms": 5,
      "tools.deferred": 7,
      "tools.schema_bytes": 4096,
      "tools.visible": 3,
    });
    expect(sink).toHaveBeenCalledTimes(3);
  });
});
