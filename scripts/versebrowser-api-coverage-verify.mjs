#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = 'harness/specs/fixtures/versebrowser-reintegration/source-lock.json';
const NEW_METHODS = ['downloadFile', 'uploadFiles', 'pointer', 'drag', 'selectOption', 'selectValues', 'appendText', 'setChecked', 'findElement', 'semanticRead', 'readForms', 'readDialogs', 'respondDialog'];

function blockAfter(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return '';
  let depth = 0;
  for (let index = start + marker.length - 1; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return text.slice(start);
}

function methodsIn(block) {
  const methods = new Set();
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s{4}([A-Za-z][A-Za-z0-9]*)\??\s*:/);
    if (match) methods.add(match[1]);
  }
  return methods;
}

export async function verifyApiCoverage(hostRoot = ROOT) {
  const lock = JSON.parse(await readFile(path.join(hostRoot, LOCK), 'utf8'));
  const contractText = await readFile(path.join(hostRoot, 'shared/host-api/contract.ts'), 'utf8');
  const clientText = await readFile(path.join(hostRoot, 'src/lib/host-api.ts'), 'utf8');
  const adapterText = await readFile(path.join(hostRoot, 'electron/services/agent-browser-api.ts'), 'utf8');
  const runtimeText = await readFile(path.join(hostRoot, 'openclaw_runtime/src/agents/tools/agent-browser-tool.ts'), 'utf8');
  const contractMethods = methodsIn(blockAfter(contractText, 'agentBrowser: {'));
  const clientMethods = methodsIn(blockAfter(clientText, 'agentBrowser: {'));
  const runtimeActionBlock = runtimeText.match(/const AGENT_BROWSER_ACTIONS = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
  const runtimeActions = new Set([...runtimeActionBlock.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((match) => match[1]));
  const expected = lock.hostApi.sourceMethods;
  const legacy = lock.hostApi.existingMethods;
  // Inspect the actual built host driver, not the adapter's facade wrappers.
  // Inject inert owners: inventory must not open browsers or touch user state.
  const { createAgentBrowserApi } = await import(pathToFileURL(path.join(hostRoot, 'packages/versebrowser/dist/engine/api.js')).href);
  const driverApi = createAgentBrowserApi({}, {});
  const implementedSourceOnly = NEW_METHODS.filter((method) => typeof driverApi[method] === 'function');
  const unavailableSourceOnly = NEW_METHODS.filter((method) => typeof driverApi[method] !== 'function');
  const issues = [];
  for (const method of expected) {
    if (!contractMethods.has(method)) issues.push({ kind: 'host_contract_missing', method });
    if (!clientMethods.has(method)) issues.push({ kind: 'host_client_missing', method });
  }
  for (const method of NEW_METHODS) {
    if (!adapterText.includes(`${method}:`)) issues.push({ kind: 'facade_adapter_missing', method });
    if (!runtimeActions.has(method)) issues.push({ kind: 'runtime_action_missing', method });
  }
  return {
    schemaVersion: 1,
    driven_by: 'agent',
    actor: 'codex',
    status: issues.length ? 'fail' : 'pass',
    scope: 'contract coverage only; not runtime capability acceptance',
    modelActions: { declared: [...runtimeActions], implementedByHostDriver: [...runtimeActions].filter((method) => typeof driverApi[method] === 'function'), snapshotRequiresOptionalCli: !runtimeActions.has('takeSnapshot') && runtimeActions.has('command') },
    driverCapabilities: { implementedSourceOnly, unavailableSourceOnly, unavailableOutcome: 'E_NOT_IMPLEMENTED; do not retry through another backend' },
    counts: { legacy: legacy.length, sourceOnly: NEW_METHODS.length, hostContract: contractMethods.size, hostClient: clientMethods.size, runtimeNewActions: NEW_METHODS.filter((method) => runtimeActions.has(method)).length },
    issues,
  };
}

async function main() {
  const { values } = parseArgs({ options: { 'host-root': { type: 'string' }, output: { type: 'string' } }, allowPositionals: false });
  const report = await verifyApiCoverage(values['host-root'] ?? ROOT);
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await writeFile(path.resolve(values.output), text, 'utf8');
  process.stdout.write(text);
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });
