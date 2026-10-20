/** Type surface for scripts/generate-catalogs.mjs (R6-4 generated catalogs). */
export type CatalogArgs = {
  check: boolean;
  outDir: string;
  now: string;
};

export function parseCatalogArgs(argv?: string[]): CatalogArgs;

export function setCatalogResolvers(resolvers: {
  resolveCoreToolProfiles: (toolId: string) => string[];
}): void;

export type CatalogSection = {
  id: string;
  label: string;
  tools: Array<{ id: string; label: string; description: string }>;
};

export function renderToolsMarkdown(sections: CatalogSection[], now: string): string;

export function renderFlagsMarkdown(flags: Array<Record<string, unknown>>, now: string): string;

export type CatalogRender = {
  sections: CatalogSection[];
  flags: Array<Record<string, unknown>>;
  toolsMarkdown: string;
  flagsMarkdown: string;
};

export type GeneratedCatalogs = CatalogRender & {
  toolsPath: string;
  flagsPath: string;
};

export type CatalogCheckResult = {
  fresh: boolean;
  issues: Array<{ file: string; reason: string }>;
};

export function validateFlagExecutors(
  flags: Array<Record<string, unknown>>,
  repoRoot?: string,
): Promise<CatalogCheckResult>;

export function renderCatalogs(options?: { outDir?: string; now?: string }): Promise<CatalogRender>;

export function generateCatalogs(options?: { outDir?: string; now?: string }): Promise<GeneratedCatalogs>;

export function checkCatalogs(options?: { outDir?: string; now?: string }): Promise<CatalogCheckResult>;
