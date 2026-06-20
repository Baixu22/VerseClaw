/**
 * @deprecated Broad public SDK barrel. Prefer focused CLI/runtime subpaths and
 * avoid adding new imports here.
 */

export * from "../gateway/cli-runtime/command-format.js";
// Removed: inheritOptionFromParent — CLI Commander-specific. No gateway equivalent.
// Removed: runCommandWithRuntime — CLI-specific. No gateway equivalent.
// Removed: formatHelpExamples — CLI-specific. No gateway equivalent.
export {
  registerLazyCommandGroup,
  findCommandGroupEntry,
  getCommandGroupNames,
  removeCommandGroupNames,
  type CommandGroupEntry,
} from "../gateway/cli-runtime/register-command-groups.js";
// Removed: registerCommandGroups — function name differs from gateway stub (registerLazyCommandGroup).
// Removed: CommandGroupPlaceholder — not exported by gateway stub.
export * from "../gateway/cli-runtime/parse-duration.js";
// Removed: resolveCliArgvInvocation, CliArgvInvocation — CLI-specific. No gateway equivalent.
// Removed: shouldEagerRegisterSubcommands — CLI-specific. No gateway equivalent.
// Removed: export * from "../cli/wait.js" — CLI-specific. No gateway equivalent.
export { note } from "../../packages/terminal-core/src/note.js";
export { stylePromptTitle } from "../../packages/terminal-core/src/prompt-style.js";
export { theme } from "../../packages/terminal-core/src/theme.js";
export * from "../version.js";
