// P5-2 CLI/TUI Deletion: fetch mock stub.
//
// The original `test-utils/fetch-mock.ts` was retired. This stub
// preserves the public surface used by `plugin-sdk/testing.ts` so
// type checking stays green.
export type FetchMock = {
  reset: () => void;
  mockResponseOnce: (response: Response) => void;
};

export function withFetchPreconnect<T>(fn: (mock: FetchMock) => Promise<T>): Promise<T> {
  const mock: FetchMock = {
    reset: () => {},
    mockResponseOnce: () => {},
  };
  return fn(mock);
}
