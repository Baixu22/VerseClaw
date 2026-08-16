import { readFileSync } from "node:fs";

function readJson(url, label) {
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const packageMetadata = readJson(new URL("../package.json", import.meta.url), "VerseShell MCP package metadata");
const runtimeManifest = readJson(
  new URL("../../verseshell/manifest.json", import.meta.url),
  "VerseShell runtime manifest",
);

if (typeof packageMetadata.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(packageMetadata.version)) {
  throw new Error("VerseShell MCP package version must be a semantic version.");
}
if (runtimeManifest?.component !== "verseshell" || runtimeManifest?.schema_version !== 2) {
  throw new Error("VerseShell MCP runtime manifest identity is incompatible.");
}
if (
  runtimeManifest.protocol?.mcp_protocol_version !== "2024-11-05"
  || runtimeManifest.protocol?.server_version !== runtimeManifest.crate?.version
) {
  throw new Error("VerseShell MCP runtime protocol metadata is incompatible.");
}

export const MCP_PACKAGE_NAME = packageMetadata.name;
export const MCP_SERVER_VERSION = packageMetadata.version;
export const MCP_SERVER_NAME = "verseshell";
export const MCP_PROTOCOL_VERSION = runtimeManifest.protocol.mcp_protocol_version;
export const RUNTIME_VERSION = runtimeManifest.crate.version;
export const RUNTIME_SERVER_PROTOCOL = runtimeManifest.protocol.expected_server_protocol;
export const OPERATION_CATALOG_DIGEST = runtimeManifest.protocol.operation_catalog_digest;
export const OPERATION_CATALOG_COUNT = runtimeManifest.protocol.operation_catalog_count;
