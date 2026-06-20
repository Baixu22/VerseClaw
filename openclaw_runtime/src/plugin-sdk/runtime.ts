/**
 * Public SDK subpath for runtime logging, env, backup, and process helpers.
 */
export type { OutputRuntimeEnv, RuntimeEnv } from "../runtime.js";
export { createNonExitingRuntime, defaultRuntime } from "../runtime.js";
export { resolveCommandSecretRefsViaGateway } from "../gateway/cli-runtime/command-secret-gateway.js";
export { getAgentRuntimeCommandSecretTargetIds as getChannelsCommandSecretTargetIds } from "../gateway/cli-runtime/command-secret-targets.js";
export {
  createLoggerBackedRuntime,
  resolveRuntimeEnv,
  resolveRuntimeEnvWithUnavailableExit,
} from "./runtime-logger.js";
export {
  danger,
  info,
  isVerbose,
  isYes,
  logVerbose,
  logVerboseConsole,
  setVerbose,
  setYes,
  shouldLogVerbose,
  success,
  warn,
} from "../globals.js";
export * from "../logging.js";
export { waitForAbortSignal } from "../infra/abort-signal.js";
// Removed: createBackupArchive — backup module was removed with CLI deletion. No gateway equivalent.
export {
  detectPluginInstallPathIssue,
  formatPluginInstallPathIssue,
} from "../infra/plugin-install-path-warnings.js";
export { collectProviderDangerousNameMatchingScopes } from "../config/dangerous-name-matching.js";
export {
  registerUncaughtExceptionHandler,
  registerUnhandledRejectionHandler,
} from "../infra/unhandled-rejections.js";
export { removePluginFromConfig } from "../plugins/uninstall.js";
