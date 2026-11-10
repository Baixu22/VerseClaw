import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const directory = process.env.PROJECT_RAG_OFFLINE_RECEIPT_DIR;
if (!directory) throw new Error('Pass the offline receipt directory');
mkdirSync(directory, { recursive: true });
const filename = `${directory}/${process.env.PROJECT_RAG_OFFLINE_RUN_ID}-${process.pid}.json`;
const receipt = { pid: process.pid, actor: 'codex/project-rag-network-guard', driven_by: 'agent', loaded: true, networkAttempts: 0, localPipeConnections: 0 };
const save = () => writeFileSync(filename, JSON.stringify(receipt, null, 2) + '\n');
const denied = () => { receipt.networkAttempts += 1; save(); throw new Error('Network blocked by the offline embedding verification guard'); };
const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const pipe = typeof first === 'string' ? first : first?.path;
  if (typeof pipe === 'string' && (pipe.startsWith('\\\\.\\pipe\\') || pipe.startsWith('\\\\?\\pipe\\') || pipe.startsWith('/'))) {
    receipt.localPipeConnections += 1; save();
    return socketConnect.apply(this, args);
  }
  return denied();
};
http.request = denied; http.get = denied; https.request = denied; https.get = denied;
globalThis.fetch = denied;
syncBuiltinESMExports(); save();
