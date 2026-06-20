// P5-2 CLI/TUI Deletion: post-install migration stub.
//
// The original `wizard/setup.post-install-migration.ts` was retired
// along with the `wizard/` directory. This stub preserves the public
// surface used by the dynamic `await import(...)` in
// `plugins/provider-auth-choice.ts`.

export type OfferPostInstallMigrationsParams<TConfig = unknown> = {
  config: TConfig;
  runtime: unknown;
  prompter: unknown;
  installedPluginIds: readonly string[];
};

export type OfferPostInstallMigrationsResult<TConfig = unknown> = {
  config: TConfig;
  migrationsRun: readonly string[];
};

export async function offerPostInstallMigrations<TConfig = unknown>(
  params: OfferPostInstallMigrationsParams<TConfig>,
): Promise<OfferPostInstallMigrationsResult<TConfig>> {
  return { config: params.config, migrationsRun: [] };
}
