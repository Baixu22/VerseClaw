import test from "node:test";
import assert from "node:assert/strict";
import {
  MCP_CAPABILITIES,
  filterTools,
  isDeferredEffectfulTool,
  parseCapabilityList,
  parseRestrictedArgv,
  requiredCapability,
  resolveMcpPolicy,
} from "../src/policy.js";
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_VERSION,
  OPERATION_CATALOG_COUNT,
  RUNTIME_VERSION,
} from "../src/identity.js";

const tools = [
  { name: "verseshell_health" },
  { name: "verseshell_file_read" },
  { name: "verseshell_process_exec" },
  { name: "verseshell_shell_exec" },
  { name: "verseshell_eval" },
  { name: "verseshell_transpile_bash" },
  { name: "verseshell_unknown" },
];

test("product profile is deny-by-default and exposes health only", () => {
  const policy = resolveMcpPolicy({ profile: "product", caps: "" });
  assert.deepEqual(filterTools(tools, policy).map((tool) => tool.name), ["verseshell_health"]);
});

test("explicit file and shell capabilities filter the catalog", () => {
  const policy = resolveMcpPolicy({ profile: "product", caps: "file.read,shell.exec" });
  assert.deepEqual(filterTools(tools, policy).map((tool) => tool.name), [
    "verseshell_health",
    "verseshell_file_read",
    "verseshell_process_exec",
  ]);
  assert.equal(requiredCapability("verseshell_process_exec"), "shell.exec");
});

test("eval and shell string compatibility are development-only", () => {
  const product = resolveMcpPolicy({ profile: "product", caps: "shell.exec" });
  assert.deepEqual(filterTools(tools, product).map((tool) => tool.name), [
    "verseshell_health",
    "verseshell_process_exec",
  ]);
  const development = resolveMcpPolicy({ profile: "development", caps: "shell.exec" });
  assert.deepEqual(filterTools(tools, development).map((tool) => tool.name), [
    "verseshell_health",
    "verseshell_process_exec",
    "verseshell_shell_exec",
    "verseshell_eval",
  ]);
});

test("wildcard and unknown capabilities fail closed", () => {
  assert.throws(() => parseCapabilityList("all"), { code: "E_CAPABILITY_CONFIG" });
  assert.throws(() => parseCapabilityList("*"), { code: "E_CAPABILITY_CONFIG" });
  assert.throws(() => parseCapabilityList("file.read,unknown"), { code: "E_CAPABILITY_CONFIG" });
});

test("effectful compatibility tools stay hidden until the governed write boundary", () => {
  const product = resolveMcpPolicy({ profile: "product", caps: "file.write" });
  assert.equal(isDeferredEffectfulTool("verseshell_file_write"), true);
  assert.deepEqual(filterTools([{ name: "verseshell_file_write" }], product), []);
});

test("restricted argv never invokes a shell parser", () => {
  assert.deepEqual(parseRestrictedArgv(["node", "script.js", "hello world"]), ["node", "script.js", "hello world"]);
  assert.deepEqual(parseRestrictedArgv('node "hello world.js"'), ["node", "hello world.js"]);
  assert.throws(() => parseRestrictedArgv("node script.js && whoami"), { code: "E_ARG" });
  assert.throws(() => parseRestrictedArgv("node 'unterminated"), { code: "E_ARG" });
});

test("identity is sourced from package and runtime manifest", () => {
  assert.match(MCP_SERVER_VERSION, /^\d+\.\d+\.\d+$/u);
  assert.equal(MCP_PROTOCOL_VERSION, "2024-11-05");
  assert.equal(RUNTIME_VERSION, "1.0.0");
  assert.equal(OPERATION_CATALOG_COUNT, 32);
});

test("capability names match the pinned runtime grant vocabulary", () => {
  assert.ok(MCP_CAPABILITIES.includes("crypto.hash"));
  assert.ok(MCP_CAPABILITIES.includes("crypto.random"));
  assert.ok(MCP_CAPABILITIES.includes("sys.uptime"));
  assert.ok(!MCP_CAPABILITIES.includes("crypto.read"));
  assert.ok(!MCP_CAPABILITIES.includes("crypto.write"));
  assert.equal(requiredCapability("verseshell_crypto_hash"), "crypto.hash");
  assert.equal(requiredCapability("verseshell_crypto_random"), "crypto.random");
  assert.equal(requiredCapability("verseshell_platform_summary"), undefined);
  assert.equal(requiredCapability("verseshell_crypto_uuid"), undefined);
});
