export type CompactionProviderRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  sampleId: string;
  purpose: string;
};

export type CompactionProviderResponse = Record<string, unknown> & {
  choices: [{ message: { content: string } & Record<string, unknown> } & Record<string, unknown>, ...unknown[]];
};

export function fetchCompactionJson(request: CompactionProviderRequest): Promise<CompactionProviderResponse>;
export function isUnresolvedFailureFact(item: unknown): boolean;
