import { loadConfig } from "../config/config.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  detectLegacyAuthProfileMigrations,
  runLegacyAuthProfileMigrations,
  type AuthProfileStateMigrationPlan,
} from "./state-migrations.js";

type MigrationResult = { changes: string[]; warnings: string[] };

type SourceDoctorDependencies = {
  loadConfig: () => OpenClawConfig;
  detectLegacyAuthProfileMigrations: (params: {
    cfg: OpenClawConfig;
  }) => AuthProfileStateMigrationPlan[];
  runLegacyAuthProfileMigrations: (params: {
    plans: AuthProfileStateMigrationPlan[];
  }) => Promise<MigrationResult>;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
};

function writeHumanReport(params: {
  fix: boolean;
  preview: string[];
  result: MigrationResult;
  write: (text: string) => void;
}): void {
  const lines: string[] = [];
  if (params.preview.length > 0) {
    lines.push("Provider auth migration detected:", ...params.preview);
  } else {
    lines.push("No provider auth migrations detected.");
  }
  if (params.fix && params.result.changes.length > 0) {
    lines.push("Doctor changes:", ...params.result.changes.map((line) => `- ${line}`));
  }
  if (params.result.warnings.length > 0) {
    lines.push("Doctor warnings:", ...params.result.warnings.map((line) => `- ${line}`));
  }
  params.write(`${lines.join("\n")}\n`);
}

/** Runs the provider-auth migration owned by the pruned source runtime Doctor command. */
export async function runSourceDoctor(
  args: string[],
  overrides: Partial<SourceDoctorDependencies> = {},
): Promise<number> {
  const dependencies: SourceDoctorDependencies = {
    loadConfig: () => loadConfig({ pin: false }),
    detectLegacyAuthProfileMigrations,
    runLegacyAuthProfileMigrations,
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
    ...overrides,
  };
  const fix = args.includes("--fix");
  const json = args.includes("--json");

  try {
    const cfg = dependencies.loadConfig();
    const plans = dependencies.detectLegacyAuthProfileMigrations({ cfg });
    const preview = plans.map(
      (plan) => `- Auth profiles: ${plan.sourcePath} -> ${plan.targetPath}`,
    );
    const result = fix
      ? await dependencies.runLegacyAuthProfileMigrations({ plans })
      : { changes: [], warnings: [] };
    if (json) {
      dependencies.writeStdout(`${JSON.stringify({ ok: true, fix, preview, ...result })}\n`);
    } else {
      writeHumanReport({ fix, preview, result, write: dependencies.writeStdout });
    }
    return 0;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    dependencies.writeStderr(
      json ? `${JSON.stringify({ ok: false, fix, error })}\n` : `${error}\n`,
    );
    return 1;
  }
}
