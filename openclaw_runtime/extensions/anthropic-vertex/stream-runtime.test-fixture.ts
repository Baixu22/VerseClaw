import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

import type { AnthropicVertexStreamDeps } from "./stream-runtime.js";

type AnthropicVertexClientOptions = ConstructorParameters<
  AnthropicVertexStreamDeps["AnthropicVertex"]
>[0];

/** Real Vertex SDK client with deterministic fixture authentication. */
export class FixtureAnthropicVertex extends AnthropicVertex {
  constructor(options: AnthropicVertexClientOptions) {
    super({
      ...options,
      authClient: {
        projectId: "rc02-fixture-project",
        getRequestHeaders: async () => ({ authorization: "Bearer rc02-fixture-token" }),
      } as never,
    });
  }
}
