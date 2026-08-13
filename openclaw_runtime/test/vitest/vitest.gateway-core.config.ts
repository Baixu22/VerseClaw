// Vitest gateway core config wires the gateway core test shard.
import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

const nonCoreGatewayTestExclude = [
  "src/gateway/server-methods/**/*.test.ts",
  "packages/gateway-protocol/src/**/*.test.ts",
  "src/gateway/**/*client*.test.ts",
  "src/gateway/**/*reconnect*.test.ts",
  "src/gateway/**/*android-node*.test.ts",
  "src/gateway/**/*gateway-cli-backend*.test.ts",
  "src/gateway/**/*server*.test.ts",
];

export function createGatewayCoreVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(["src/gateway/**/*.test.ts"], {
    dir: "src/gateway",
    env,
    exclude: nonCoreGatewayTestExclude,
    name: "gateway-core",
  });
}

export default createGatewayCoreVitestConfig();

