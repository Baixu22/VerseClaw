// Vitest gateway config wires the gateway test shard.
import { createProjectShardVitestConfig } from "./vitest.project-shard-config.ts";
import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

const gatewayProjectConfigs = [
  "test/vitest/vitest.gateway-core.config.ts",
  "test/vitest/vitest.gateway-client.config.ts",
  "test/vitest/vitest.gateway-methods.config.ts",
  "test/vitest/vitest.gateway-server.config.ts",
] as const;

export function createGatewayVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(["src/gateway/**/*.test.ts"], {
    dir: "src/gateway",
    env,
    exclude: [
    ],
    name: "gateway",
  });
}

export function createGatewayProjectShardVitestConfig() {
  return createProjectShardVitestConfig(gatewayProjectConfigs);
}

export default process.env.OPENCLAW_GATEWAY_PROJECT_SHARDS === "0"
  ? createGatewayVitestConfig()
  : createGatewayProjectShardVitestConfig();

