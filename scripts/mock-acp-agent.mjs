#!/usr/bin/env node
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
let sessionId = null;
function send(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
rl.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, close: {} }, promptCapabilities: { image: false, audio: false, embeddedContext: true } },
      authMethods: [],
      agentInfo: { name: 'clawx-mock-acp', title: 'ClawX mock ACP', version: '1.0.0' },
    } });
    return;
  }
  if (message.method === 'session/new') {
    sessionId = 'mock-session-' + Date.now();
    send({ jsonrpc: '2.0', id: message.id, result: { sessionId } });
    return;
  }
  if (message.method === 'session/prompt') {
    const text = Array.isArray(message.params?.prompt) ? message.params.prompt.map((part) => part.text ?? '').join('') : '';
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: message.params?.sessionId ?? sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'MOCK_ACP_OK:' + text.slice(0, 40) } } } });
    send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } });
    return;
  }
  if (message.method === 'session/cancel') {
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: message.params?.sessionId ?? sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'CANCEL_ACK' } } } });
    return;
  }
  if (message.id != null) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found: ' + message.method } });
});
