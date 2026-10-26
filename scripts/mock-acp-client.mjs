#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
const child = spawn(process.execPath, [path.resolve('scripts/mock-acp-agent.mjs')], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
let buffer = '';
const pending = new Map();
let nextId = 1;
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)); } }, 5000);
  });
}
function notify(method, params) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); p.resolve(msg); }
  }
});
const initialize = await request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true }, clientInfo: { name: 'clawx-test', version: '1.0.0' } });
const created = await request('session/new', { cwd: process.cwd(), mcpServers: [] });
const prompt = await request('session/prompt', { sessionId: created.result.sessionId, prompt: [{ type: 'text', text: 'ping' }] });
notify('session/cancel', { sessionId: created.result.sessionId });
await new Promise((r) => setTimeout(r, 100));
console.log(JSON.stringify({ initialize: initialize.result, sessionId: created.result.sessionId, prompt: prompt.result }, null, 2));
child.kill();
