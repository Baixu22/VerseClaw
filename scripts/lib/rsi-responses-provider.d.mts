export type ResponsesStatus =
  | 'completed'
  | 'failed'
  | 'in_progress'
  | 'cancelled'
  | 'queued'
  | 'incomplete';

export interface ResponsesRequest {
  model: string;
  instructions: string;
  input: unknown;
  store: false;
  stream: false;
  truncation: 'disabled';
  max_output_tokens: number;
}

export interface ResponsesUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ResponsesFunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface ResponsesReply {
  id: string;
  model: string;
  status: ResponsesStatus;
  text: string;
  usage: ResponsesUsage | null;
  functionCalls: ResponsesFunctionCall[];
  incompleteReason: string | null;
}

export interface ResponsesRequestEvidence {
  url: string;
  method: 'POST';
  headers: {
    accept: 'application/json';
    'content-type': 'application/json';
  };
  redirect: 'error';
  cache: 'no-store';
  body: ResponsesRequest;
}

export interface ResponsesProviderResult {
  request: ResponsesRequestEvidence;
  response: ResponsesReply;
  rawResponse: unknown;
}

export type ResponsesTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface ResponsesProviderOptions {
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxOutputTokens: number;
  transport?: ResponsesTransport;
}

export function buildResponsesRequest(input: {
  model: string;
  instructions: string;
  input: unknown;
  maxOutputTokens: number;
}): ResponsesRequest;

export function parseResponsesReply(payload: unknown): ResponsesReply;

export function createResponsesProvider(
  options: ResponsesProviderOptions,
): (input: { instructions: string; input: unknown }) => Promise<ResponsesProviderResult>;
