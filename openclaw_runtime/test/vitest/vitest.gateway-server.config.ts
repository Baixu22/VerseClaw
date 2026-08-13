// Vitest gateway server config wires the gateway server test shard.
import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

const gatewayServerBackedHttpTests = [
];

export function createGatewayServerVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(
    ["src/gateway/**/*server*.test.ts", ...gatewayServerBackedHttpTests],
    {
      dir: "src/gateway",
      env,
      exclude: [
        "src/gateway/server-methods/**/*.test.ts",
      ],
      fileParallelism: false,
      isolate: false,
      name: "gateway-server",
    },
  );
}

export default createGatewayServerVitestConfig();

