import { Agent, request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';

// A declared loopback resource must not inherit a machine-wide fetch proxy.
const loopbackAgent = new Agent({ keepAlive: false, proxyEnv: {} });
function sendLoopback(url, init) {
  return new Promise((resolveReply, rejectReply) => {
    const request = httpRequest(url, { method: init.method, headers: init.headers,
      signal: init.signal, agent: loopbackAgent }, response => {
      const status = response.statusCode ?? 500;
      const body = [204, 205, 304].includes(status) ? null : Readable.toWeb(response);
      resolveReply(new Response(body, { status, headers: {
        'content-type': String(response.headers['content-type'] ?? 'application/json'),
      } }));
    });
    request.on('error', rejectReply);
    request.end(init.body);
  });
}

const RESPONSE_STATUSES = new Set([
  'completed',
  'failed',
  'in_progress',
  'cancelled',
  'queued',
  'incomplete',
]);
const MAX_RESPONSE_BODY_BYTES = 1024 * 1024;

class ResponseBodyLimitError extends Error {}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

async function readResponseText(response) {
  const body = response.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (!(result.value instanceof Uint8Array)) {
          throw new Error('Responses response body failed (invalid body)');
        }
        bytes += result.value.byteLength;
        if (bytes > MAX_RESPONSE_BODY_BYTES) {
          reader.cancel().catch(() => undefined);
          throw new ResponseBodyLimitError('Responses response body exceeded 1 MiB');
        }
        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }

    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(joined);
  }

  const text = await response.text();
  if (
    typeof text === 'string' &&
    new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BODY_BYTES
  ) {
    throw new ResponseBodyLimitError('Responses response body exceeded 1 MiB');
  }
  return text;
}

function parseUsage(usage) {
  if (usage == null) return null;
  assertRecord(usage, 'usage');

  const fields = [
    ['input_tokens', 'inputTokens'],
    ['output_tokens', 'outputTokens'],
    ['total_tokens', 'totalTokens'],
  ];
  const parsed = {};

  for (const [source, target] of fields) {
    if (!Object.prototype.hasOwnProperty.call(usage, source)) continue;
    const value = usage[source];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`usage.${source} must be a non-negative integer`);
    }
    parsed[target] = value;
  }

  if (fields.some(([source]) => !Object.prototype.hasOwnProperty.call(usage, source))) {
    return null;
  }
  if (parsed.inputTokens + parsed.outputTokens !== parsed.totalTokens) {
    throw new Error('usage totals are inconsistent');
  }
  return parsed;
}

function parseEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') {
    throw new Error('endpoint must be a non-empty URL');
  }

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('endpoint must be a valid URL');
  }

  if (url.username || url.password) throw new Error('endpoint must not contain userinfo');
  if (url.search) throw new Error('endpoint must not contain a query string');
  if (url.hash) throw new Error('endpoint must not contain a fragment');

  const hostname = url.hostname.toLowerCase();
  const loopback =
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname);

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('endpoint must use HTTPS, or HTTP on an explicit loopback host');
  }
  return url;
}

function readIncompleteReason(payload) {
  if (payload.status !== 'incomplete') return null;
  const details = payload.incomplete_details;
  if (details == null) return null;
  assertRecord(details, 'incomplete_details');
  if (details.reason == null) return null;
  assertNonEmptyString(details.reason, 'incomplete_details.reason');
  return details.reason;
}

function readOutput(output) {
  if (output == null) return { text: '', functionCalls: [] };
  if (!Array.isArray(output)) throw new Error('output must be an array');

  const textParts = [];
  const functionCalls = [];

  for (const item of output) {
    assertRecord(item, 'output item');
    if (item.type === 'message') {
      if (!Array.isArray(item.content)) {
        throw new Error('message content must be an array');
      }
      for (const content of item.content) {
        assertRecord(content, 'message content item');
        if (content.type !== 'output_text') continue;
        if (typeof content.text !== 'string') {
          throw new Error('output_text.text must be a string');
        }
        textParts.push(content.text);
      }
      continue;
    }

    if (item.type === 'function_call') {
      assertNonEmptyString(item.call_id, 'function_call.call_id');
      assertNonEmptyString(item.name, 'function_call.name');
      if (typeof item.arguments !== 'string') {
        throw new Error('function_call.arguments must be a string');
      }
      functionCalls.push({
        callId: item.call_id,
        name: item.name,
        arguments: item.arguments,
      });
    }
  }

  return { text: textParts.join(''), functionCalls };
}

export function buildResponsesRequest({ model, instructions, input, maxOutputTokens, reasoningEffort, jsonSchema, tools }) {
  assertNonEmptyString(model, 'model');
  if (typeof instructions !== 'string') {
    throw new Error('instructions must be a string');
  }
  if (input === undefined) throw new Error('input is required');
  assertPositiveInteger(maxOutputTokens, 'maxOutputTokens');
  if (reasoningEffort !== undefined && reasoningEffort !== 'low') throw new Error('reasoningEffort must be low');
  if (jsonSchema !== undefined) assertRecord(jsonSchema, 'jsonSchema');
  if (tools !== undefined && (!Array.isArray(tools) || tools.some(tool => !isRecord(tool)
    || tool.type !== 'function' || typeof tool.name !== 'string' || !isRecord(tool.parameters)))) {
    throw new Error('tools must be declared function schemas');
  }

  return {
    model,
    instructions,
    input,
    store: false,
    stream: false,
    truncation: 'disabled',
    max_output_tokens: maxOutputTokens,
    ...(tools ? { tools: structuredClone(tools) } : {}),
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    ...(jsonSchema ? { text: { format: { type: 'json_schema', name: 'rsi_coding_edits', strict: true, schema: jsonSchema } } } : {}),
  };
}

export function parseResponsesReply(payload) {
  assertRecord(payload, 'response payload');
  assertNonEmptyString(payload.id, 'response id');
  assertNonEmptyString(payload.model, 'response model');
  if (typeof payload.status !== 'string' || !RESPONSE_STATUSES.has(payload.status)) {
    throw new Error('response status is invalid');
  }

  const { text, functionCalls } = readOutput(payload.output);
  return {
    id: payload.id,
    model: payload.model,
    status: payload.status,
    text,
    usage: parseUsage(payload.usage),
    functionCalls,
    incompleteReason: readIncompleteReason(payload),
  };
}

export function createResponsesProvider({
  endpoint,
  model,
  apiKey,
  timeoutMs,
  maxOutputTokens,
  transport,
  reasoningEffort,
  jsonSchema,
  tools,
}) {
  const url = parseEndpoint(endpoint);
  assertNonEmptyString(model, 'model');
  assertNonEmptyString(apiKey, 'apiKey');
  assertPositiveInteger(timeoutMs, 'timeoutMs');
  assertPositiveInteger(maxOutputTokens, 'maxOutputTokens');

  const send = transport ?? (url.protocol === 'http:' ? sendLoopback : globalThis.fetch);
  if (typeof send !== 'function') throw new Error('transport must be a function');

  return async ({ instructions, input }) => {
    const body = buildResponsesRequest({ model, instructions, input, maxOutputTokens, reasoningEffort, jsonSchema, tools });
    const request = {
      url: url.href,
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      redirect: 'error',
      cache: 'no-store',
      body,
    };

    const controller = new AbortController();
    let timedOut = false;
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('Responses request timed out'));
      }, timeoutMs);
    });

    try {
      let fetched;
      try {
        fetched = await Promise.race([
          Promise.resolve().then(() =>
            send(url.href, {
              method: request.method,
              headers: {
                ...request.headers,
                authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(body),
              redirect: 'error',
              cache: 'no-store',
              signal: controller.signal,
            }),
          ),
          deadline,
        ]);
      } catch {
        if (timedOut) throw new Error('Responses request timed out');
        throw new Error('Responses transport failed (network error)');
      }

      if (
        !isRecord(fetched) ||
        typeof fetched.ok !== 'boolean' ||
        typeof fetched.text !== 'function'
      ) {
        throw new Error('Responses transport returned an invalid HTTP response');
      }
      if (!fetched.ok) {
        const status =
          Number.isInteger(fetched.status) && fetched.status >= 100 && fetched.status <= 599
            ? fetched.status
            : null;
        throw new Error(
          status === null
            ? 'Responses request failed with HTTP error'
            : `Responses request failed with HTTP ${status}`,
        );
      }

      let raw;
      try {
        raw = await Promise.race([Promise.resolve().then(() => readResponseText(fetched)), deadline]);
      } catch (error) {
        if (timedOut) throw new Error('Responses request timed out');
        if (error instanceof ResponseBodyLimitError) throw error;
        throw new Error('Responses response body failed (transport error)');
      }
      if (typeof raw !== 'string') {
        throw new Error('Responses response body failed (invalid body)');
      }

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error('Responses reply was invalid JSON');
      }

      return { request, response: parseResponsesReply(payload), rawResponse: payload };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
