// FactStore ignore policy (SPEC Task 2 / appendix A "从 ClawX 现有代码抄").
// Lists adapted from runtime-core/agent-map.ts AGENT_MAP_DEFAULT_INPUT_LIMITS.ignoredDirectories
// and AGENT_MAP_GENERATED_FILE_SUFFIXES so the fact layer and the legacy map agree on
// what never gets indexed. `.openclaw` is added so the store never indexes its own database.

export const FACTSTORE_IGNORED_DIRECTORIES = [
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".openclaw",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
] as const;

export const FACTSTORE_GENERATED_FILE_SUFFIXES = [
  ".gen.js",
  ".gen.jsx",
  ".gen.ts",
  ".gen.tsx",
  ".generated.js",
  ".generated.jsx",
  ".generated.ts",
  ".generated.tsx",
  ".min.js",
  ".min.jsx",
] as const;

const IGNORED_DIRECTORY_SET = new Set<string>(FACTSTORE_IGNORED_DIRECTORIES);

/** Normalize a repo-relative path to forward slashes without a leading "./". */
export function normalizeFactPath(relPath: string): string {
  let normalized = relPath.replaceAll("\\", "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized.replace(/^\/+/, "");
}

/**
 * Returns the ignore reason when the path must never enter the FactStore,
 * or undefined when the path is indexable.
 */
export function factStoreIgnoreReason(relPath: string): string | undefined {
  const normalized = normalizeFactPath(relPath);
  const lower = normalized.toLowerCase();
  for (const segment of lower.split("/")) {
    if (IGNORED_DIRECTORY_SET.has(segment)) {
      return `ignored_directory:${segment}`;
    }
  }
  for (const suffix of FACTSTORE_GENERATED_FILE_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return `generated_suffix:${suffix}`;
    }
  }
  return undefined;
}
