import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { AuthProfileStateMigrationPlan } from "./state-migrations.js";
import { runSourceDoctor } from "./source-doctor.js";

const cfg = {} as OpenClawConfig;
const plans: AuthProfileStateMigrationPlan[] = [
  {
    agentDir: "agent",
    sourcePath: "auth-profiles.json",
    targetPath: "openclaw-agent.sqlite",
  },
];

describe("source runtime Doctor", () => {
  it("diagnoses without mutating state", async () => {
    const run = vi.fn();
    let output = "";

    const exitCode = await runSourceDoctor(["--json"], {
      loadConfig: () => cfg,
      detectLegacyAuthProfileMigrations: () => plans,
      runLegacyAuthProfileMigrations: run,
      writeStdout: (text) => {
        output += text;
      },
    });

    expect(exitCode).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      fix: false,
      preview: ["- Auth profiles: auth-profiles.json -> openclaw-agent.sqlite"],
    });
  });

  it("runs explicit fixes and reports their result", async () => {
    const run = vi.fn(async () => ({ changes: ["migrated"], warnings: [] }));
    let output = "";

    const exitCode = await runSourceDoctor(["--fix", "--yes", "--non-interactive"], {
      loadConfig: () => cfg,
      detectLegacyAuthProfileMigrations: () => plans,
      runLegacyAuthProfileMigrations: run,
      writeStdout: (text) => {
        output += text;
      },
    });

    expect(exitCode).toBe(0);
    expect(run).toHaveBeenCalledWith({ plans });
    expect(output).toContain("Doctor changes:");
    expect(output).toContain("migrated");
  });
});
