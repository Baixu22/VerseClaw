import type { Command } from "commander";

export function resolveActionArgs(actionCommand?: Command): string[] {
  const args = (actionCommand as (Command & { args?: string[] }) | undefined)?.args;
  return Array.isArray(args) ? args : [];
}

function appendOptionValue(out: string[], flag: string, value: unknown): void {
  if (value === true) {
    out.push(flag);
  } else if (typeof value === "string" || typeof value === "number") {
    out.push(flag, String(value));
  }
}

export function resolveCommandOptionArgs(command?: Command): string[] {
  if (!command) {
    return [];
  }
  const out: string[] = [];
  for (const option of command.options) {
    const name = option.attributeName();
    if (
      typeof command.getOptionValueSource === "function" &&
      command.getOptionValueSource(name) === "default"
    ) {
      continue;
    }
    const flag = option.long ?? option.short;
    if (!flag) {
      continue;
    }
    const value = command.getOptionValue(name);
    if (Array.isArray(value)) {
      for (const item of value) {
        appendOptionValue(out, flag, item);
      }
    } else {
      appendOptionValue(out, flag, value);
    }
  }
  return out;
}
