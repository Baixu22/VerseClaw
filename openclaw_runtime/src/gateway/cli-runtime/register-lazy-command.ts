import type { Command } from "commander";
import { reparseProgramFromActionArgs } from "./action-reparse.js";
import { removeCommandByName } from "./command-tree.js";
import { resolveCommandOptionArgs } from "./helpers.js";

export function registerLazyCommand(params: {
  program: Command;
  name: string;
  description: string;
  options?: readonly { flags: string; description: string }[];
  removeNames?: readonly string[];
  register: () => Promise<void> | void;
}): void {
  const placeholder = params.program.command(params.name).description(params.description);
  for (const option of params.options ?? []) {
    placeholder.option(option.flags, option.description);
  }
  placeholder.allowUnknownOption(true);
  placeholder.allowExcessArguments(true);
  placeholder.action(async (...actionArgs) => {
    const actionCommand = actionArgs.at(-1) as
      | (Command & { args?: string[] })
      | undefined;
    if (actionCommand) {
      actionCommand.args = [
        ...resolveCommandOptionArgs(actionCommand),
        ...(actionCommand.args ?? []),
      ];
    }
    for (const name of new Set(params.removeNames ?? [params.name])) {
      removeCommandByName(params.program, name);
    }
    await params.register();
    await reparseProgramFromActionArgs(params.program, actionArgs);
  });
}
