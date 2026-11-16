import { getRuntimeConfig } from "../config/config.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  detectLegacyAuthProfileMigrations,
  runLegacyAuthProfileMigrations,
  type AuthProfileStateMigrationPlan,
} from "./state-migrations.js";

type MigrationResult = { changes: string[]; warnings: string[] };

type SourceDoctorDependencies = {
  readConfig: () => OpenClawConfig;
  detectLegacyAuthProfileMigrations: (params: {
    cfg: OpenClawConfig;
  }) => AuthProfileStateMigrationPlan[];
  runLegacyAuthProfileMigrations: (params: {
    plans: AuthProfileStateMigrationPlan[];
  }) => Promise<MigrationResult>;
  writeStdout: (text: string) => void | Promise<void>;
  writeStderr: (text: string) => void | Promise<void>;
};

async function writeHumanReport(params: {
  fix: boolean;
  preview: string[];
  result: MigrationResult;
  write: (text: string) => void | Promise<void>;
}): Promise<void> {
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
  await params.write(`${lines.join("\n")}\n`);
}

function writeToStream(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (error?: Error | null) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/** Runs the provider-auth migration owned by the pruned source runtime Doctor command. */
export async function runSourceDoctor(
  args: string[],
  overrides: Partial<SourceDoctorDependencies> = {},
): Promise<number> {
  const dependencies: SourceDoctorDependencies = {
    // getRuntimeConfig is the approved process-boundary config loader (source
    // Doctor runs from entry.ts); a bare loadConfig() call is guard-banned.
    readConfig: () => getRuntimeConfig({ pin: false }),
    detectLegacyAuthProfileMigrations,
    runLegacyAuthProfileMigrations,
    writeStdout: (text) => writeToStream(process.stdout, text),
    writeStderr: (text) => writeToStream(process.stderr, text),
    ...overrides,
  };
  const fix = args.includes("--fix");
  const json = args.includes("--json");

  try {
    const cfg = dependencies.readConfig();
    const plans = dependencies.detectLegacyAuthProfileMigrations({ cfg });
    const preview = plans.map(
      (plan) => `- Auth profiles: ${plan.sourcePath} -> ${plan.targetPath}`,
    );
    const result = fix
      ? await dependencies.runLegacyAuthProfileMigrations({ plans })
      : { changes: [], warnings: [] };
    if (json) {
      await dependencies.writeStdout(`${JSON.stringify({ ok: true, fix, preview, ...result })}\n`);
    } else {
      await writeHumanReport({ fix, preview, result, write: dependencies.writeStdout });
    }
    return 0;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await dependencies.writeStderr(
      json ? `${JSON.stringify({ ok: false, fix, error })}\n` : `${error}\n`,
    );
    return 1;
  }
}
