import type { Command } from "commander";

const MAX_INHERIT_DEPTH = 2;

function getOptionSource(command: Command, name: string): string | undefined {
  return typeof command.getOptionValueSource === "function"
    ? command.getOptionValueSource(name)
    : undefined;
}

export function inheritOptionFromParent<T = unknown>(
  command: Command | undefined,
  name: string,
): T | undefined {
  if (!command) {
    return undefined;
  }
  const childSource = getOptionSource(command, name);
  if (childSource && childSource !== "default") {
    return undefined;
  }
  let depth = 0;
  let ancestor = command.parent;
  while (ancestor && depth < MAX_INHERIT_DEPTH) {
    const source = getOptionSource(ancestor, name);
    if (source && source !== "default") {
      return ancestor.opts<Record<string, unknown>>()[name] as T | undefined;
    }
    depth += 1;
    ancestor = ancestor.parent;
  }
  return undefined;
}
