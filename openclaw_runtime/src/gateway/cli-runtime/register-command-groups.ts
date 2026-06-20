// P5-2 CLI/TUI Deletion: CLI command group registry stub.
//
// The original `cli/program/register-command-groups.ts` was retired
// along with the `cli/` directory. This stub preserves the public
// surface used by plugins to register, lookup, and unregister lazy
// CLI command groups. At runtime, no groups are registered (the
// runtime does not host a CLI), so the registry is permanently empty
// and the call sites fall through to their eager/no-op paths.

import type { Command } from "commander";

export type CommandGroupEntry = {
  // `name` and `load` are optional because plugin-sdk consumers
  // produce entries via `buildPluginCliCommandGroupEntries` which
  // uses `pluginId` (not `name`) and defers loading to `register`.
  name?: string;
  parentPath?: readonly string[];
  description?: string;
  load?: (program: Command) => Promise<void> | void;
  register: (program: Command) => Promise<void> | void;
  // Placeholders are intentionally typed as `unknown[]` to remain
  // compatible with descriptor-shaped callers in the plugin SDK; the
  // registrar re-asserts the descriptor type at the call site.
  placeholders: readonly unknown[];
};

const lazyGroups = new Map<string, CommandGroupEntry>();

export function registerLazyCommandGroup(
  _program: Command,
  entry: CommandGroupEntry,
  _placeholder: unknown,
): void {
  lazyGroups.set(entry.name ?? "", entry);
}

export function findCommandGroupEntry(
  entries: readonly CommandGroupEntry[],
  name: string,
): CommandGroupEntry | undefined {
  return entries.find((e) => (e.name ?? (e as { pluginId?: string }).pluginId) === name);
}

export function getCommandGroupNames(entry: CommandGroupEntry): readonly string[] {
  // Prefer the descriptor-shape `names` field when present (used by
  // the plugin registrar); fall back to placeholders-as-strings or
  // the entry's own name/pluginId.
  const fromNames = (entry as { names?: readonly string[] }).names;
  if (fromNames && fromNames.length > 0) return fromNames;
  if (entry.placeholders.length > 0) {
    return entry.placeholders.map((p) =>
      typeof p === "string" ? p : (p as { name?: string }).name ?? entry.name ?? "",
    );
  }
  return [entry.name ?? ""];
}

export function removeCommandGroupNames(
  _program: Command,
  entry: CommandGroupEntry,
): void {
  lazyGroups.delete(entry.name ?? "");
}
