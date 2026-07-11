/**
 * @deprecated Broad public SDK barrel. Prefer focused CLI/runtime subpaths and
 * avoid adding new imports here.
 */

import { formatErrorMessage } from "../infra/errors.js";

export * from "../gateway/cli-runtime/command-format.js";
export { inheritOptionFromParent } from "../gateway/cli-runtime/command-options.js";
export { formatHelpExamples, type HelpExample } from "../cli/help-format.js";
export {
  registerCommandGroups,
  registerLazyCommandGroup,
  findCommandGroupEntry,
  getCommandGroupNames,
  removeCommandGroupNames,
  type CommandGroupEntry,
  type CommandGroupPlaceholder,
} from "../gateway/cli-runtime/register-command-groups.js";
export * from "../gateway/cli-runtime/parse-duration.js";
export {
  resolveCliArgvInvocation,
  type CliArgvInvocation,
} from "../gateway/cli-runtime/argv-invocation.js";
export { shouldEagerRegisterSubcommands } from "../gateway/cli-runtime/command-registration-policy.js";
// Removed: export * from "../cli/wait.js" — CLI-specific. No gateway equivalent.
export { note } from "../../packages/terminal-core/src/note.js";
export { stylePromptTitle } from "../../packages/terminal-core/src/prompt-style.js";
export { theme } from "../../packages/terminal-core/src/theme.js";
export * from "../version.js";

export async function runCommandWithRuntime(
  runtime: { error: (message: string) => void; exit: (code: number) => void },
  action: () => Promise<void>,
  onError?: (error: unknown) => void,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (onError) {
      onError(error);
      return;
    }
    runtime.error(formatErrorMessage(error));
    runtime.exit(1);
  }
}
