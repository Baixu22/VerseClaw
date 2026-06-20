/**
 * Runtime SDK subpath for config file writes and mutation helpers.
 */
export { logConfigUpdated } from "../config/logging.js";
export { readConfigFileSnapshotForWrite } from "../config/io.js";
export { mutateConfigFile, replaceConfigFile } from "../config/mutate.js";
export type { ConfigWriteAfterWrite } from "../config/runtime-snapshot.js";
// Removed: updateConfig — CLI-specific config mutation. Use mutateConfigFile() or replaceConfigFile() instead.
