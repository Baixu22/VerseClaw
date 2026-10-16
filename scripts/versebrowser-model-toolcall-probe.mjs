import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

// Real model tool call against the existing authorized LOCAL endpoint
// (D:/versebrowser/.local/config/third-party-llm.env). No credential is printed.
const { values } = parseArgs({ options: { envfile: { type: 'string' }, output: { type: 'string' } }, allowPositionals: false });
const envPath = values.envfile ?? 'D:/versebrowser/.local/config/third-party-llm.env';
const output = resolve(values.output ?? 'D:/tmp/clawx-vb-n7-20261016/model');
await mkdir(output, { recursive: true });
const env = {};
for (const raw of (await readFile(envPath, 'utf8')).split(/\r?\n/)) {
  const line = raw.trim().replace(/^\uFEFF/, '');
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const [k, ...rest] = line.split('=');
  env[k.trim()] = rest.join('=').trim();
}
const base = env.VERSE_LLM_BASE, path = env.VERSE_LLM_PATH, model = env.VERSE_LLM_MODEL, key = env.VERSE_LLM_KEY;

// The advertised action set is the one the runtime tool ships (declared minus the 13
// driver-unavailable source-only methods); kept in sync by the N5 drift-guard test.
const advertised = ['open','status','navigate','waitForSelector','click','type','evaluate','screenshot','close','getConsoleMessages','takeSnapshot','extractPageText','pressKey','verifyFlow'];
const tools = [{
  type: 'function',
  function: {
    name: 'agent_browser',
    description: "Drive Verse Claw's internal Agent Browser.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: { action: { type: 'string', enum: advertised }, sessionId: { type: 'string' }, url: { type: 'string' }, selector: { type: 'string' }, key: { type: 'string' } },
    },
  },
}];

const receipt = { driven_by: 'agent', actor: 'codex', scope: 'real local model -> tool call capture; not the ClawX packaged path', endpointHost: new URL(base).host, model, advertisedActions: advertised };
try {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Open https://example.com in the agent browser, then take a snapshot of the page. Use the agent_browser tool.' }] }],
      tools,
      tool_choice: 'auto',
      max_output_tokens: 400,
    }),
  });
  receipt.httpStatus = res.status;
  const bodyText = await res.text();
  let body; try { body = JSON.parse(bodyText); } catch { body = { raw: bodyText.slice(0, 2000) }; }
  receipt.response = body;
  const outputItems = body.output ?? body.choices?.[0]?.message?.tool_calls ?? [];
  const calls = [];
  for (const item of outputItems) {
    if (item.type === 'function_call') calls.push({ name: item.name, arguments: item.arguments, callId: item.call_id ?? item.id });
    if (item.type === 'tool_call') calls.push({ name: item.function?.name, arguments: item.function?.arguments, callId: item.id });
  }
  receipt.toolCalls = calls;
  receipt.status = res.ok && calls.length > 0 ? 'pass' : 'fail';
  if (receipt.status === 'fail') receipt.note = 'no real function_call returned';
} catch (error) {
  receipt.status = 'fail';
  receipt.error = String(error?.message ?? error);
}
await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ status: receipt.status, httpStatus: receipt.httpStatus, toolCalls: receipt.toolCalls, error: receipt.error, note: receipt.note }));
process.exitCode = receipt.status === 'pass' ? 0 : 1;
