import { afterEach, describe, expect, it } from "vitest";
import { runExecProcess } from "../bash-tools.exec-runtime.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

const FLAG_ENV = [
  "VERSE_VERSESHELL_FOUNDATION_KILL_SWITCH",
  "VERSE_VERSESHELL_FOUNDATION_VERIFIED_RUNTIME",
  "VERSE_VERSESHELL_FOUNDATION_TYPED_ACI",
  "VERSE_VERSESHELL_FOUNDATION_FACADE",
  "VERSE_VERSESHELL_FOUNDATION_GOVERNED_EXEC",
  "VERSE_VERSESHELL_FOUNDATION_LEGACY_EVAL",
  "VERSE_VERSESHELL_FOUNDATION_NATIVE_FALLBACK",
  "VERSESHELL_RUNTIME_VERSION",
  "VERSESHELL_SERVER_PROTOCOL",
  "VERSESHELL_OPERATION_CATALOG_DIGEST",
  "VERSESHELL_OPERATION_CATALOG_COUNT",
] as const;

const previousEnv = new Map<string, string | undefined>();

function setEnv(name: (typeof FLAG_ENV)[number], value?: string): void {
  if (!previousEnv.has(name)) previousEnv.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function runVerseShell(config?: OpenClawConfig) {
  const handle = await runExecProcess({
    command: "node --version",
    execHost: "verseshell",
    hostPolicyApproved: true,
    config,
    workdir: process.cwd(),
    env: {},
    usePty: false,
    warnings: [],
    maxOutput: 20_000,
    pendingMaxOutput: 20_000,
    notifyOnExit: false,
    timeoutSec: 5,
  });
  return await handle.promise;
}

afterEach(() => {
  for (const [name, value] of previousEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  previousEnv.clear();
});

describe("VerseShell exec host rollout boundary", () => {
  it("is default-off and does not execute a native shell", async () => {
    for (const name of FLAG_ENV) setEnv(name);
    const outcome = await runVerseShell();
    expect(outcome.status).toBe("failed");
    expect(outcome.aggregated).toContain("VerseShell governed ACI and legacy eval are disabled");
  });

  it("fails closed on a governed contract error even if compatibility fallback is enabled", async () => {
    for (const name of FLAG_ENV) setEnv(name);
    setEnv("VERSE_VERSESHELL_FOUNDATION_VERIFIED_RUNTIME", "true");
    setEnv("VERSE_VERSESHELL_FOUNDATION_TYPED_ACI", "true");
    setEnv("VERSE_VERSESHELL_FOUNDATION_FACADE", "true");
    setEnv("VERSE_VERSESHELL_FOUNDATION_GOVERNED_EXEC", "true");
    setEnv("VERSE_VERSESHELL_FOUNDATION_LEGACY_EVAL", "true");
    setEnv("VERSE_VERSESHELL_FOUNDATION_NATIVE_FALLBACK", "true");

    const outcome = await runVerseShell();
    expect(outcome.status).toBe("failed");
    expect(outcome.aggregated).toContain("VERSESHELL_OPERATION_CATALOG_DIGEST");
  });

  it("honors the strict OpenClaw config rollout without requiring environment flags", async () => {
    for (const name of FLAG_ENV) setEnv(name);
    const outcome = await runVerseShell({
      runtime: {
        verseShellFoundation: {
          verifiedRuntime: true,
          typedAci: true,
          facade: true,
          governedExec: true,
        },
      },
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.aggregated).toContain("VERSESHELL_OPERATION_CATALOG_DIGEST");
  });
});
