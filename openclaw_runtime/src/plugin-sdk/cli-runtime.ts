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
import { registerLazyCommandGroup } from "../gateway/cli-runtime/register-command-groups.js";
import type { Command } from "commander";

export type CommandGroupPlaceholder = {
  name: string;
  description?: string;
  options?: readonly { flags: string; description?: string }[];
};

export function registerCommandGroups(
  program: Command,
  groups: ReadonlyArray<{
    name?: string;
    placeholders: readonly CommandGroupPlaceholder[];
    register: (program: Command) => Promise<void> | void;
  }>,
  _options: { eager?: boolean; primary?: string | null; registerPrimaryOnly?: boolean } = {},
): void {
  for (const group of groups) {
    for (const placeholder of group.placeholders) {
      registerLazyCommandGroup(
        program,
        {
          name: placeholder.name,
          description: placeholder.description,
          register: group.register,
          placeholders: [placeholder],
        },
        placeholder,
      );
    }
  }
}

export type CliArgvInvocation = { argv: string[]; commandName?: string };

export function resolveCliArgvInvocation(argv: readonly string[] = process.argv): CliArgvInvocation {
  return { argv: [...argv] };
}

export function shouldEagerRegisterSubcommands(): boolean {
  return false;
}

export async function runCommandWithRuntime<T>(
  _label: string,
  action: () => Promise<T> | T,
): Promise<T> {
  return await action();
}


export function formatHelpExamples(examples: unknown): string {
  if (!Array.isArray(examples)) {
    return "";
  }
  return examples
    .map((example) => {
      if (typeof example === "string") {
        return example;
      }
      if (example && typeof example === "object" && "command" in example) {
        return String((example as { command: unknown }).command);
      }
      return "";
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

export function inheritOptionFromParent<T = unknown>(command: Command, key: string): T | undefined {
  for (let current = command.parent; current; current = current.parent) {
    const opts = typeof current.opts === "function" ? (current.opts() as Record<string, unknown>) : {};
    if (Object.prototype.hasOwnProperty.call(opts, key)) {
      return opts[key] as T;
    }
  }
  return undefined;
}
