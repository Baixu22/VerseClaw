import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';

export type ResponsesFault = '401' | '404' | '429' | '500' | '504' | 'timeout' | 'malformed' | 'drop' | 'cancel';
type Json = Record<string, unknown>;
export type ProviderObservation = {
  requestId: string;
  path: string;
  requestedModel: unknown;
  stream: boolean;
  inputHash: string;
  inputItems: Json[];
  fixtureResultInInput: boolean;
  fault: ResponsesFault | null;
  httpStatus?: number;
  providerRequestId?: string | null;
  firstByteMs?: number;
  completionMs?: number;
  events: Json[];
  aborted: boolean;
  safetyCutoff: boolean;
  error?: string;
};

export function readSpaceBunnyResource() {
  const endpoint = process.env.CLAWX_SPACE_BUNNY_ENDPOINT?.trim();
  const model = process.env.CLAWX_SPACE_BUNNY_MODEL?.trim();
  const apiKey = process.env.CLAWX_SPACE_BUNNY_API_KEY?.trim();
  assert(endpoint && model && apiKey, 'Required space-bunny environment is missing; live acceptance cannot skip');
  assert.equal(model, 'space-bunny');
  const url = new URL(endpoint);
  assert.equal(url.hostname, '127.0.0.1', 'Only the authorized loopback resource is permitted');
  assert.equal(url.pathname, '/v1/responses');
  return { endpoint, model, apiKey };
}

function asObject(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

export function redactSpaceBunny(value: string): string {
  const key = process.env.CLAWX_SPACE_BUNNY_API_KEY;
  return (key ? value.split(key).join('[REDACTED]') : value)
    .replace(/sk-[A-Za-z0-9._-]+/g, '[REDACTED]')
    .replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [REDACTED]');
}

function textOfResponse(response: Json): string {
  const output = Array.isArray(response.output) ? response.output : [];
  return output.flatMap(item => {
    const content = asObject(item).content;
    return Array.isArray(content) ? content : [];
  }).map(part => asObject(part).text ?? '').join('');
}

function parseEventBlock(block: string): Json | null {
  const data = block.split(/\r?\n/).filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim()).join('\n');
  if (!data || data === '[DONE]') return null;
  return asObject(JSON.parse(data));
}

function summarizeEvent(event: Json): Json {
  const response = asObject(event.response);
  const item = asObject(event.item);
  return {
    type: event.type,
    ...(Object.keys(response).length ? { response: {
      id: response.id, model: response.model, status: response.status,
      usage: response.usage ?? null, error: response.error ?? null,
      output: response.output ?? [], text: textOfResponse(response),
    } } : {}),
    ...(Object.keys(item).length ? { item } : {}),
    ...Object.fromEntries(['delta', 'text', 'item_id', 'output_index', 'content_index', 'arguments']
      .filter(key => event[key] !== undefined).map(key => [key, event[key]])),
  };
}

function summarizeInput(body: Json): Json[] {
  return (Array.isArray(body.input) ? body.input : [{ role: 'user', content: body.input }])
    .map(raw => {
      const item = asObject(raw);
      if (item.role === 'system' || item.role === 'developer') {
        return { role: item.role, contentHash: createHash('sha256').update(JSON.stringify(item)).digest('hex') };
      }
      return item;
    });
}

export async function probeSpaceBunny() {
  const resource = readSpaceBunnyResource();
  const requests: Json[] = [];
  const request = async (label: string, input: unknown, extra: Json = {}): Promise<Json> => {
    const requestId = randomUUID();
    const body: Json = { model: resource.model, input, max_output_tokens: 512, ...extra };
    const started = performance.now();
    const response = await fetch(resource.endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${resource.apiKey}`, 'x-request-id': requestId },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
    });
    const firstByteMs = performance.now() - started;
    const raw = await response.text();
    assert.equal(response.status, 200, `${label}: HTTP ${response.status}: ${redactSpaceBunny(raw).slice(0, 400)}`);
    const events = body.stream
      ? raw.split(/\r?\n\r?\n/).map(parseEventBlock).filter((event): event is Json => event !== null)
      : [];
    const result = body.stream
      ? asObject(events.find(event => event.type === 'response.completed')?.response)
      : asObject(JSON.parse(raw));
    assert.equal(result.status, 'completed', `${label}: missing completed response`);
    assert.equal(result.model, resource.model, `${label}: returned model mismatch`);
    assert.equal(typeof result.id, 'string');
    requests.push({
      label, requestId, providerRequestId: response.headers.get('x-request-id'),
      body, firstByteMs, completionMs: performance.now() - started, httpStatus: response.status,
      response: result, eventTypes: events.map(event => event.type), cost: null,
    });
    return result;
  };
  const marker = `GA_${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
  const plain = await request('text', `Copy this opaque identifier exactly, without explanation or tools: ${marker}`);
  assert(textOfResponse(plain).includes(marker), 'Direct text marker missing');
  const stream = await request('sse', `Copy this opaque identifier exactly, without explanation or tools: ${marker}_SSE`, { stream: true });
  assert(textOfResponse(stream).includes(`${marker}_SSE`), 'SSE marker missing');
  const tool = { type: 'function', name: 'ga_echo', description: 'Return the provided text unchanged.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, strict: true };
  const input = [{ role: 'user', content: 'Call ga_echo once with text "echo-input", then quote its result.' }];
  const called = await request('tool-call', input, { tools: [tool], tool_choice: { type: 'function', name: 'ga_echo' } });
  const calls = (called.output as Json[]).filter(item => item.type === 'function_call');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'ga_echo');
  assert.equal(asObject(JSON.parse(String(calls[0].arguments))).text, 'echo-input');
  const resultMarker = `ECHO_${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
  const final = await request('tool-result', [...input, ...called.output as Json[],
    { type: 'function_call_output', call_id: calls[0].call_id, output: resultMarker }], { tools: [tool], tool_choice: 'none' });
  assert(textOfResponse(final).includes(resultMarker), 'Final response did not use observed tool output');
  return { actor: 'codex-playwright', driven_by: 'agent', status: 'pass', requests,
    toolsExecuted: 1, callId: calls[0].call_id, resultMarker, limitations: ['returned model is an alias; underlying model identity is unverified', 'cost unavailable'] };
}

export async function startSpaceBunnyProxy(fixtureMarker: string) {
  const resource = readSpaceBunnyResource();
  const observations: ProviderObservation[] = [];
  const sockets = new Set<Socket>();
  const controllers = new Set<AbortController>();
  const proxyToken = randomUUID();
  let fault: { type: ResponsesFault; marker: string } | null = null;
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${proxyToken}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid acceptance proxy credential' } }));
      return;
    }
    if (req.url?.startsWith('/v1/models')) {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: resource.model, object: 'model' }] }));
      return;
    }
    if (req.url !== '/v1/responses') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Only the Responses protocol is allowed' } }));
      return;
    }
    if (req.method !== 'POST' || !req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      res.writeHead(req.method === 'POST' ? 415 : 405);
      res.end();
      return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    let observation: ProviderObservation | undefined;
    res.once('close', () => {
      if (!res.writableFinished) {
        if (observation) observation.aborted = true;
        controller.abort();
      }
      if (timer) clearTimeout(timer);
    });
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        assert(bytes <= 2_000_000, 'Provider request exceeds observation cap');
        chunks.push(buffer);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = asObject(JSON.parse(raw));
      const injected = fault && raw.includes(fault.marker) ? fault.type : null;
      observation = { requestId: randomUUID(), path: req.url, requestedModel: body.model,
        stream: body.stream === true, inputHash: createHash('sha256').update(raw).digest('hex'),
        inputItems: summarizeInput(body), fixtureResultInInput: raw.includes(fixtureMarker),
        fault: injected, events: [], aborted: false, safetyCutoff: false };
      observations.push(observation);
      if (injected && ['401', '404', '429', '500', '504'].includes(injected)) {
        const status = Number(injected);
        observation.httpStatus = status;
        if (!controller.signal.aborted) {
          res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '0' });
          res.end(JSON.stringify({ error: { code: `ga_fault_${injected}`, message: `Injected ${injected} provider failure` } }));
        }
        return;
      }
      if (injected) {
        observation.httpStatus = 200;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.flushHeaders();
        const frames: Json[] = [
          { type: 'response.created', response: { id: observation.requestId, model: resource.model, status: 'in_progress' } },
          ...(injected === 'timeout' ? [] : [
            { type: 'response.content_part.added', output_index: 0, part: { type: 'output_text', text: '' } },
            { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'INCOMPLETE_PROVIDER_FRAGMENT' },
          ]),
        ];
        frames.forEach(frame => { observation!.events.push(summarizeEvent(frame)); res.write(`data: ${JSON.stringify(frame)}\n\n`); });
        if (injected === 'malformed') res.end('data: {malformed-json}\n\n');
        else if (injected === 'drop') res.end();
        else await new Promise<void>(resolve => {
          controller.signal.addEventListener('abort', () => resolve(), { once: true });
          timer = setTimeout(() => { observation!.safetyCutoff = true; res.destroy(); resolve(); }, 180_000);
        });
        return;
      }
      assert.equal(body.model, resource.model, 'Unexpected product model');
      const upstream = await fetch(resource.endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${resource.apiKey}`,
          'x-request-id': observation.requestId },
        body: raw, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
      });
      observation.httpStatus = upstream.status;
      observation.providerRequestId = upstream.headers.get('x-request-id');
      observation.firstByteMs = performance.now() - started;
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
      let pending = '';
      const decoder = new TextDecoder();
      if (upstream.body) for await (const chunk of upstream.body) {
        res.write(chunk);
        pending += decoder.decode(chunk, { stream: true });
        if (body.stream === true) {
          const blocks = pending.split(/\r?\n\r?\n/);
          pending = blocks.pop() ?? '';
          for (const block of blocks) {
            const event = parseEventBlock(block);
            if (event) observation.events.push(summarizeEvent(event));
          }
        }
      }
      if (body.stream !== true && pending) observation.events.push({ type: 'json-response', response: asObject(JSON.parse(pending)) });
      res.end();
    } catch (error) {
      if (observation) observation.error = redactSpaceBunny(String(error)).slice(0, 500);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      if (!res.destroyed) res.end(JSON.stringify({ error: { message: 'Upstream proxy request failed' } }));
    } finally {
      if (timer) clearTimeout(timer);
      controllers.delete(controller);
      if (observation) observation.completionMs = performance.now() - started;
    }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    proxyToken,
    baseUrl: `http://127.0.0.1:${address.port}/v1`, observations,
    inject(type: ResponsesFault, marker: string) { fault = { type, marker }; },
    clearFault() { fault = null; },
    activeRequests: () => controllers.size,
    async close() {
      controllers.forEach(controller => controller.abort());
      sockets.forEach(socket => socket.destroy());
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await new Promise(resolve => setTimeout(resolve, 20));
      return { listening: server.listening, sockets: sockets.size, requests: controllers.size };
    },
  };
}
