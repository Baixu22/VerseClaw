import type { Command } from "commander";
import { buildParseArgv } from "./argv.js";
import { resolveActionArgs } from "./helpers.js";

function findRootCommand(command: Command): Command {
  let current = command;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}

export async function reparseProgramFromActionArgs(
  program: Command,
  actionArgs: unknown[],
): Promise<void> {
  const actionCommand = actionArgs.at(-1) as Command | undefined;
  const root = findRootCommand(actionCommand ?? program);
  const rawArgs = (root as Command & { rawArgs?: string[] }).rawArgs;
  const fallbackArgv = [
    actionCommand?.name() ?? "",
    ...resolveActionArgs(actionCommand),
  ].filter(Boolean);
  await root.parseAsync(
    buildParseArgv({
      programName: root.name(),
      rawArgs,
      fallbackArgv,
    }),
  );
}
