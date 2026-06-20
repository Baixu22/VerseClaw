// P5-2 CLI/TUI Deletion: provider usage fetch stub.
//
// The original `test-utils/provider-usage-fetch.ts` was retired. This
// stub preserves the public surface used by `plugin-sdk/testing.ts` and
// any remaining consumers so type checking stays green.
export type ProviderUsageFetch = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
};

export function createProviderUsageFetch(_options?: unknown): ProviderUsageFetch {
  return {
    fetch: async () => new Response("{}", { status: 200 }),
  };
}

export function makeResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, init);
}
