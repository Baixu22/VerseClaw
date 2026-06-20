// P5-2 CLI/TUI Deletion: CliDeps type and CLI dependency factories.
//
// This barrel re-exports the CliDeps type plus the createDefaultDeps /
// createOutboundSendDeps factories from the relocated gateway/cli-runtime/
// module. In P5-1 the factories lived under src/cli/ and this barrel
// existed so the gateway could swap import targets atomically. In P5-2
// the factories (and their dependencies) have been physically moved
// next to the gateway so the legacy src/cli/ directory can be deleted.
export type { CliDeps } from "../cli-runtime/deps.types.js";
export { createDefaultDeps, createOutboundSendDeps } from "../cli-runtime/deps.js";
