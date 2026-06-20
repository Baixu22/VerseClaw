// Logging config helpers read and normalize logger configuration.
import fs from "node:fs";
import { isRecord as isObjectRecord } from "@openclaw/normalization-core/record-coerce";
import JSON5 from "json5";
import { resolveConfigPath } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";

// Lightweight logging-config reader used before the full config runtime is safe to load.
type LoggingConfig = OpenClawConfig["logging"];

/**
 * P5-2 CLI/TUI Deletion: this is a minimal replacement for the previous
 * `cli/argv.js` helper that the logging module used to detect schema/
 * validate invocations. The full CLI argv parser was retired along with
 * the `cli/` directory; the gateway only needs the leading command path
 * for the same skip-config-read guard the helper provided.
 */
function getCommandPathWithRootOptions(argv: readonly string[], depth: number): string[] {
  return argv.slice(2, 2 + depth);
}

let cachedLoggingConfig:
  | {
      path: string;
      logging: LoggingConfig | undefined;
    }
  | undefined;

/** Avoids config reads that can mutate or validate config while schema/config commands run. */
export function shouldSkipMutatingLoggingConfigRead(argv: string[] = process.argv): boolean {
  const [primary, secondary] = getCommandPathWithRootOptions(argv, 2);
  return primary === "config" && (secondary === "schema" || secondary === "validate");
}

/** Reads the logging block from config, caching by resolved config path. */
export function readLoggingConfig(): LoggingConfig | undefined {
  if (shouldSkipMutatingLoggingConfigRead()) {
    return undefined;
  }
  try {
    const configPath = resolveConfigPath();
    if (cachedLoggingConfig?.path === configPath) {
      return cachedLoggingConfig.logging;
    }
    if (!fs.existsSync(configPath)) {
      return undefined;
    }
    // JSON5 mirrors the main config parser while keeping this early logger path dependency-light.
    const parsed = JSON5.parse(fs.readFileSync(configPath, "utf8"));
    const logging = isObjectRecord(parsed) ? parsed.logging : undefined;
    const resolved = isObjectRecord(logging) ? (logging as LoggingConfig) : undefined;
    cachedLoggingConfig = {
      path: configPath,
      logging: resolved,
    };
    return resolved;
  } catch {
    return undefined;
  }
}
