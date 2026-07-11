/**
 * Runtime SDK subpath for config file writes and mutation helpers.
 */
export { logConfigUpdated } from "../config/logging.js";
export { readConfigFileSnapshotForWrite } from "../config/io.js";
export { mutateConfigFile, replaceConfigFile } from "../config/mutate.js";
export type { ConfigWriteAfterWrite } from "../config/runtime-snapshot.js";
// Removed: updateConfig — CLI-specific config mutation. Use mutateConfigFile() or replaceConfigFile() instead.


/** Back-compat shim for retained bundled plugins that still import the old CLI helper. */
export async function updateConfig<T = void>(
  mutate: Parameters<typeof mutateConfigFile<T>>[0]["mutate"],
): Promise<Awaited<ReturnType<typeof mutateConfigFile<T>>>> {
  return await mutateConfigFile<T>({ mutate });
}
