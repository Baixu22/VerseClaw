/**
 * Public SDK subpath for memory host CLI runtime utilities and terminal helpers.
 */
export * from "../../packages/memory-host-sdk/src/runtime-cli.js";
export { formatErrorMessage } from "../infra/errors.js";
// Removed: withManager — CLI-specific Commander helper. No gateway equivalent.
export { resolveCommandSecretRefsViaGateway } from "../gateway/cli-runtime/command-secret-gateway.js";
// Removed: formatHelpExamples — CLI-specific. No gateway equivalent.
// Removed: withProgress, withProgressTotals — CLI progress-only. No gateway equivalent.
export { isVerbose, setVerbose } from "../globals.js";
export { defaultRuntime } from "../runtime.js";
export { formatDocsLink } from "../../packages/terminal-core/src/links.js";
export { colorize, isRich, theme } from "../../packages/terminal-core/src/theme.js";
export { shortenHomeInString, shortenHomePath } from "../utils.js";
