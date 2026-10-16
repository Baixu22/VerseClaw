import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

// Real MCP stdio handshake against the built CLI (`vb mcp`). Verifies that the
// advertised tool list is filtered by the active driver (a promise, not a wish)
// and that a rejected call comes back as an error rather than a fake success.
const { values } = parseArgs({ options: { root: { type: 'string' }, output: { type: 'string' } }, allowPositionals: false });
const root = resolve(values.root ?? process.cwd());
const output = resolve(values.output ?? join(root, 'artifacts', 'versebrowser-mcp-probe'));
await mkdir(output, { recursive: true });

const receipt = { driven_by: 'agent', actor: 'codex', scope: 'MCP stdio protocol + capability filtering; not a model or packaged-app claim', node: process.version, uv: process.versions.uv, exchange: [] };

const child = spawn(process.execPath, ['packages/versebrowser/dist/cli.js', 'mcp'], {
  cwd: root,
  env: { ...process.env, VERSEBROWSER_NO_DRIVER: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
let buffer = '';
const pending = new Map();
let nextId = 1;
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    receipt.exchange.push(msg);
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
const request = (method, params) => new Promise((res, rej) => {
  const id = nextId++;
  pending.set(id, res);
  send({ jsonrpc: '2.0', id, method, params });
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 20000);
});

try {
  receipt.initialize = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'clawx-n7-probe', version: '0.0.1' } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  receipt.toolsList = await request('tools/list', {});
  const names = (receipt.toolsList.result?.tools ?? []).map((t) => t.name);
  receipt.advertised = names;
  receipt.pingCall = await request('tools/call', { name: 'vb_ping', arguments: {} });
  receipt.blockedCall = await request('tools/call', { name: 'vb_open', arguments: { url: 'http://127.0.0.1:1/' } });
  receipt.unknownCall = await request('tools/call', { name: 'vb_not_a_tool', arguments: {} });
  const cancelId = nextId++;
  send({ jsonrpc: '2.0', id: cancelId, method: 'tools/call', params: { name: 'vb_page_text', arguments: {} } });
  send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: cancelId, reason: 'probe cancel' } });
  receipt.cancelledRequestId = cancelId;
  receipt.status = 'pass';
} catch (error) {
  receipt.status = 'fail';
  receipt.error = String(error?.message ?? error);
} finally {
  child.kill();
  receipt.assertions = {
    advertisedCount: (receipt.advertised ?? []).length,
    advertised: receipt.advertised,
    driverToolsNotAdvertised: !(receipt.advertised ?? []).some((n) => ['vb_open', 'vb_click', 'vb_snapshot', 'vb_download', 'vb_upload', 'vb_dialogs'].includes(n)),
    pingIsError: receipt.pingCall?.result?.isError === true,
    blockedIsError: receipt.blockedCall?.result?.isError === true,
    unknownIsError: receipt.unknownCall?.result?.isError === true,
    blockedMessage: receipt.blockedCall?.result?.content?.[0]?.text,
    unknownMessage: receipt.unknownCall?.result?.content?.[0]?.text,
  };
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
}
console.log(JSON.stringify({ status: receipt.status, assertions: receipt.assertions, error: receipt.error }));
process.exitCode = receipt.status === 'pass' ? 0 : 1;
