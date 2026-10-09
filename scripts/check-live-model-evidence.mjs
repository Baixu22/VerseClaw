import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { RpcClient } from './chain-audit/lib/rpc-client.js';

const output = path.resolve(process.argv[2] ?? '');
assert(process.argv[2], 'Pass a new output directory');
assert(!fs.existsSync(output), 'Preserve existing attempts; choose a new directory');
fs.mkdirSync(output, { recursive: true });
const baseUrl = (process.env.LIVE_MODEL_BASE_URL ?? '').replace(/\/$/, '');
const model = process.env.LIVE_MODEL_ID;
const runtimeRead = process.env.LIVE_MODEL_RUNTIME_READ === '1';
let stdin = ''; for await (const chunk of process.stdin) stdin += chunk;
const { key } = JSON.parse(stdin); stdin = '';
assert(new URL(baseUrl).protocol === 'https:' && model && key, 'HTTPS endpoint, model and stdin key required');
const report = { driven_by: 'agent', actor: 'script-live-model', startedAt: new Date().toISOString(), baseUrl, model, passed: false, maxProviderRequests: 8, requests: [], checks: [] };
const hash = value => createHash('sha256').update(value).digest('hex');
const safe = value => (JSON.stringify(value, null, 2) ?? 'null').replaceAll(key, '[REDACTED_CREDENTIAL]');
const save = () => fs.writeFileSync(path.join(output, 'report.json'), safe(report) + '\n');
const textOf = message => typeof message?.content === 'string' ? message.content.trim() : (message?.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('').trim();
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let calls = 0;
async function completion(body, label, onHeaders, onChunk) {
  assert(++calls <= report.maxProviderRequests, 'Provider request budget exceeded');
  const started = Date.now();
  const row = { number: calls, label, toolNames: (body.tools ?? []).map(tool => tool.function?.name), model: body.model, stream: body.stream === true, parameters: Object.fromEntries(Object.entries(body).filter(([k]) => !['messages', 'tools'].includes(k))), toolCount: body.tools?.length ?? 0, requestBytes: Buffer.byteLength(JSON.stringify(body)), requestSha256: hash(JSON.stringify(body)) };
  report.requests.push(row); save();
  const response = await fetch(baseUrl + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(120_000) });
  row.status = response.status;
  onHeaders?.(response);
  let raw = '';
  for await (const chunk of response.body) { raw += Buffer.from(chunk).toString('utf8'); onChunk?.(chunk); }
  row.durationMs = Date.now() - started;
  row.responseSha256 = hash(raw);
  const frames = body.stream && response.ok
    ? raw.split(/\r?\n/).filter(l => l.startsWith('data: ') && l !== 'data: [DONE]').map(l => JSON.parse(l.slice(6)))
    : [JSON.parse(raw)];
  row.content = body.stream ? frames.flatMap(f => f.choices ?? []).map(c => c.delta?.content ?? '').join('') : frames[0].choices?.[0]?.message?.content;
  row.usageWithChoiceFrames = frames.filter(f => f.usage && f.choices?.some(c => c.delta && Object.values(c.delta).some(Boolean))).length;
  row.deltaKeys = [...new Set(frames.flatMap(f => f.choices ?? []).flatMap(c => Object.keys(c.delta ?? {})))];
  row.toolCallChunks = frames.flatMap(f => f.choices ?? []).filter(c => c.delta?.tool_calls?.length).length;
  row.usage = frames.findLast(f => f.usage)?.usage ?? null;
  row.returnedModel = frames.find(f => f.model)?.model ?? null;
  row.finishReason = frames.flatMap(f => f.choices ?? []).findLast(c => c.finish_reason)?.finish_reason ?? null;
  row.streamChunks = body.stream ? frames.length : undefined;
  if (!response.ok) row.error = frames[0].error;
  save();
  assert(response.ok, 'Provider failed: ' + response.status + ' ' + safe(frames[0].error));
  return body.stream ? { content: frames.flatMap(f => f.choices ?? []).map(c => c.delta?.content ?? '').join(''), row } : { message: frames[0].choices?.[0]?.message, row };
}
let gateway, client, relay, gatewayText = '';
const gatewayHasExited = () => !gateway || gateway.exitCode !== null || gateway.signalCode !== null;
try {
  if (process.env.LIVE_MODEL_GATEWAY_ONLY !== '1') {
  const streamed = await completion({ model, messages: [{ role: 'user', content: 'Reply exactly STREAM-LIVE-OK. No tools or formatting.' }], stream: true, stream_options: { include_usage: true }, max_tokens: 512 }, 'direct-stream');
  assert.equal(streamed.content.trim(), 'STREAM-LIVE-OK');
  assert(streamed.row.usage?.total_tokens > 0, 'Provider must report streaming usage');
  report.checks.push({ name: 'streaming', passed: true, response: streamed.content.trim() });
  const messages = [{ role: 'user', content: 'Use lookup_fixture to retrieve fixture evidence-blue. Do not invent its value.' }];
  const tools = [{ type: 'function', function: { name: 'lookup_fixture', description: 'Read a synthetic fixture by id.', parameters: { type: 'object', properties: { id: { type: 'string', enum: ['evidence-blue'] } }, required: ['id'], additionalProperties: false } } }];
  const invocation = await completion({ model, messages, tools, tool_choice: { type: 'function', function: { name: 'lookup_fixture' } }, max_tokens: 512 }, 'direct-tool-selection');
  const tool = invocation.message?.tool_calls?.[0];
  assert.equal(invocation.message.tool_calls.length, 1);
  assert.equal(tool.function.name, 'lookup_fixture');
  assert.deepEqual(JSON.parse(tool.function.arguments), { id: 'evidence-blue' });
  const value = 'VALUE-' + randomUUID().slice(0, 8);
  messages.push(invocation.message, { role: 'tool', tool_call_id: tool.id, content: JSON.stringify({ value }) }, { role: 'user', content: 'Reply exactly the value returned by the tool. No formatting.' });
  const toolReply = await completion({ model, messages, max_tokens: 512 }, 'direct-tool-result');
  assert.equal(textOf(toolReply.message), value);
  report.checks.push({ name: 'function-call-roundtrip', passed: true, tool: tool.function.name, arguments: JSON.parse(tool.function.arguments), expected: value, actual: textOf(toolReply.message), execution: 'agent-driven synthetic lookup; not runtime filesystem tool evidence' });

  } else { report.diagnosticSubset = 'gateway-only'; }

  // Real provider credentials stay in this relay, never in the runtime configuration.
  relay = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions', 'Unexpected provider route');
      assert.equal(req.method, 'POST');
      let raw = ''; for await (const chunk of req) { raw += chunk; assert(raw.length <= 1_000_000, 'Request too large'); }
      const body = JSON.parse(raw); assert.equal(body.model, model);
      assert((body.max_tokens ?? body.max_completion_tokens ?? 0) > 0 && (body.max_tokens ?? body.max_completion_tokens) <= 2048, 'Runtime output budget missing or too large');
      await completion(body, 'gateway-runtime', upstream => { res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }); }, chunk => res.write(chunk));
      res.end();
    } catch (error) { report.relayError = String(error.message).replaceAll(key, '[REDACTED_CREDENTIAL]'); save(); if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Evidence relay failed; see sanitized report' } })); }
  });
  const relayPort = await listen(relay);
  const portProbe = createServer(); const gatewayPort = await listen(portProbe); await new Promise(resolve => portProbe.close(resolve));
  const state = path.join(output, 'state'), home = path.join(output, 'home'), workspace = path.join(output, 'workspace');
  for (const p of [state, home, workspace]) fs.mkdirSync(p);
  const configPath = path.join(output, 'openclaw.json');
  const config = { gateway: { mode: 'local', controlUi: { enabled: false } }, models: { mode: 'merge', providers: { 'stepfun-evidence': { api: 'openai-completions', baseUrl: 'http://127.0.0.1:' + relayPort + '/v1', apiKey: 'synthetic-relay-auth', models: [{ id: model, name: model, api: 'openai-completions', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 1024 }] } } }, agents: { defaults: { model: { primary: 'stepfun-evidence/' + model, fallbacks: [] }, models: { ['stepfun-evidence/' + model]: { params: { maxTokens: 1024 } } }, workspace, skipBootstrap: true, thinkingDefault: 'off', timeoutSeconds: 120 }, list: [{ id: 'main', default: true }] }, tools: runtimeRead ? { allow: ['read'], fs: { workspaceOnly: true } } : { deny: ['*'] }, skills: { allowBundled: [] } };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  const token = randomUUID();
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'), XDG_CONFIG_HOME: path.join(home, '.config'), OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_STATE_DIR: state, OPENCLAW_DISABLE_BONJOUR: '1', OPENCLAW_SKIP_CHANNELS: '1' };
  delete env.CLAWX_LIVE_API_KEY; delete env.NODE_OPTIONS;
  const entry = path.resolve('openclaw_runtime/dist/entry.js');
  gateway = spawn(process.execPath, [entry, 'gateway', '--port', String(gatewayPort), '--token', token, '--allow-unconfigured'], { cwd: path.dirname(path.dirname(entry)), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  gateway.stdout.on('data', c => { gatewayText += c; }); gateway.stderr.on('data', c => { gatewayText += c; });
  report.gateway = { pid: gateway.pid, entry, entrySha256: hash(fs.readFileSync(entry)), ready: false };
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) { assert(!gatewayHasExited(), 'Gateway exited'); try { const r = await fetch('http://127.0.0.1:' + gatewayPort + '/readyz', { signal: AbortSignal.timeout(2000) }); if (r.ok && (await r.json()).ready) { report.gateway.ready = true; break; } } catch {} await sleep(500); }
  assert(report.gateway.ready, 'Gateway readiness timed out');
  client = new RpcClient({ port: gatewayPort, token, scopes: ['operator.admin', 'operator.read', 'operator.write'] });
  await client.connect();
  const rpc = async (method, params, timeout = 30_000) => { const r = await client.call(method, params, timeout); assert(r.ok, method + ': ' + safe(r.error)); return r.payload; };
  const sessionKey = 'agent:main:stepfun-evidence';
  const marker = 'marker-' + randomUUID().slice(0, 8);
  const turns = [ { prompt: 'Remember ' + marker + ' for this conversation. Reply exactly RUNTIME-LIVE-OK-1. Do not call tools.', expected: 'RUNTIME-LIVE-OK-1' }, { prompt: 'Recall the marker from my previous message. Reply exactly that marker. Do not call tools.', expected: marker } ];
  const fixturePath = path.join(workspace, 'live-read-fixture.txt');
  const fixtureValue = 'RUNTIME-READ-' + randomUUID();
  if (runtimeRead) {
    fs.writeFileSync(fixturePath, fixtureValue + '\n');
    report.runtimeReadFixture = { path: fixturePath, sha256: hash(fs.readFileSync(fixturePath)), driven_by: 'agent', valueProvidedInPrompt: false };
    turns.push({ prompt: 'Use the read tool exactly once to read live-read-fixture.txt in your workspace. Reply exactly the complete value in that file, without formatting or commentary. Do not guess the value and do not call any other tool.', expected: fixtureValue });
  }
  for (const [index, turn] of turns.entries()) {
    const sent = await rpc('agent', { sessionKey, message: turn.prompt, deliver: false, timeout: 120, idempotencyKey: randomUUID() });
    const ended = await rpc('agent.wait', { runId: sent.runId, timeoutMs: 150000 }, 160000);
    assert.equal(ended.status, 'ok', 'Runtime agent failed: ' + safe(ended));
    const history = await rpc('chat.history', { sessionKey, limit: 30, maxChars: 500000 });
    const assistant = history.messages.filter(m => m.role === 'assistant').at(-1);
    fs.writeFileSync(path.join(output, 'history-turn-' + (index + 1) + '.json'), safe(history) + '\n');
    assert.equal(textOf(assistant), turn.expected);
    if (runtimeRead && index === 2) {
      const calls = history.messages.flatMap(m => (Array.isArray(m.content) ? m.content : []).filter(c => c.type === 'toolCall'));
      const results = history.messages.filter(m => m.role === 'toolResult');
      assert.equal(calls.length, 1, 'Runtime must invoke read exactly once');
      assert.equal(calls[0].name, 'read');
      const requestedPath = calls[0].arguments?.path ?? calls[0].arguments?.file_path;
      assert.equal(path.resolve(workspace, requestedPath), fixturePath);
      const result = results.find(m => m.toolCallId === calls[0].id);
      assert(result && !result.isError, 'Missing successful Runtime tool result');
      assert(textOf(result).includes(fixtureValue), 'Runtime tool result did not read the random file');
      assert.equal(hash(fs.readFileSync(fixturePath)), report.runtimeReadFixture.sha256, 'Read must not modify fixture bytes');
      report.checks.push({ name: 'runtime-read-tool', passed: true, execution: 'real Runtime read; real provider selected and consumed result', toolCall: calls[0], toolResult: result, expected: fixtureValue, actual: textOf(assistant) });
    }
    report.checks.push({ name: 'runtime-turn-' + (index + 1), passed: true, runId: sent.runId, expected: turn.expected, actual: textOf(assistant), model: assistant.model, provider: assistant.provider, usage: assistant.usage }); save();
  }
  const usageDeadline = Date.now() + 30_000;
  do {
    report.runtimeUsage = await rpc('sessions.usage', { key: sessionKey, range: 'all', limit: 10 });
    if (report.runtimeUsage.totals?.totalTokens > 0) break;
    await sleep(500);
  } while (Date.now() < usageDeadline);
  assert(report.runtimeUsage.totals?.totalTokens > 0, 'Runtime aggregate usage did not refresh');
  assert(report.requests.filter(r => r.label === 'gateway-runtime').every(r => r.usage?.total_tokens > 0), 'Runtime provider usage missing');
  report.passed = true;
} catch (error) { report.error = String(error.stack ?? error).replaceAll(key, '[REDACTED_CREDENTIAL]'); process.exitCode = 1; }
finally {
  client?.close();
  if (!gatewayHasExited()) { gateway.kill(); await Promise.race([new Promise(resolve => gateway.once('close', resolve)), sleep(5000)]); if (!gatewayHasExited()) { report.forcedCleanup = true; const killer = spawn('taskkill.exe', ['/PID', String(gateway.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); await new Promise(resolve => killer.once('close', resolve)); } }
  report.gatewayExited = gatewayHasExited();
  if (relay) { relay.closeAllConnections(); await new Promise(resolve => relay.close(resolve)); }
  fs.writeFileSync(path.join(output, 'gateway.log'), gatewayText.replaceAll(key, '[REDACTED_CREDENTIAL]'));
  report.completedAt = new Date().toISOString(); report.providerRequests = calls; save();
  assert(!fs.readFileSync(path.join(output, 'report.json'), 'utf8').includes(key));
  console.log(JSON.stringify({ passed: report.passed, requests: calls, checks: report.checks.length, report: path.join(output, 'report.json') }));
}
