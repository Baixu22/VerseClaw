// P5-2 CLI/TUI Deletion: command descriptor utility stubs.
//
// The original `cli/program/command-descriptor-utils.ts` was retired
// along with the `cli/` directory. The remaining consumers only need
// the normalization helpers and the unique-descriptor collector used
// in plugin registration metadata. The descriptor parameter is
// intentionally generic (must have a `name` string) so any descriptor
// shape from the plugin SDK (e.g. `OpenClawPluginCliCommandDescriptor`)
// is accepted without a structural conversion.

export type NamedCommandDescriptor = {
  name: string;
  [key: string]: unknown;
};

export type CommandDescriptor = NamedCommandDescriptor;

export function normalizeCommandDescriptorName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export function sanitizeCommandDescriptorDescription(description: string): string {
  return description.replace(/\s+/g, " ").trim();
}

export function collectUniqueCommandDescriptors<T extends NamedCommandDescriptor>(
  descriptors: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const d of descriptors) {
    const key = normalizeCommandDescriptorName(d.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}
