import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, pathMatchesAny, toArray } from './specs.mjs';

const DIRECT_IPC_PATTERN = /window\.electron\.ipcRenderer\.invoke\s*\(/;
const GATEWAY_LOCAL_HOST_PATTERN = String.raw`(?:127\.0\.0\.1|localhost|\[::1\])`;
const DIRECT_GATEWAY_HTTP_PATTERN = new RegExp(String.raw`fetch\s*\(\s*['"\`]http:\/\/${GATEWAY_LOCAL_HOST_PATTERN}:18789`);
const DIRECT_GATEWAY_WS_PATTERN = new RegExp(String.raw`new\s+WebSocket\s*\(\s*['"\`]ws:\/\/${GATEWAY_LOCAL_HOST_PATTERN}:18789|ws:\/\/${GATEWAY_LOCAL_HOST_PATTERN}:18789`);
const HOST_API_LOCAL_HTTP_PATTERN = /fetch\s*\(\s*['"`]http:\/\/(?:127\.0\.0\.1|localhost):13210|HOST_API_BASE\s*=\s*`?http:\/\/127\.0\.0\.1:\$\{HOST_API_PORT\}`?/;
const GATEWAY_READY_MUTATION_PATTERN = /gatewayReady\s*[:=]\s*(?:true|false)|setStatus\s*\([^)]*gatewayReady|setState\s*\([^)]*gatewayReady/s;
const COMMUNICATION_PATHS = [
  'src/lib/api-client.ts',
  'src/lib/host-api.ts',
  'src/lib/host-api-client.ts',
  'src/stores/gateway.ts',
  'src/stores/chat.ts',
  'src/stores/chat/**',
  'electron/main/ipc/**',
  'electron/services/**',
  'electron/gateway/**',
  'electron/preload/**',
  'electron/utils/**',
];

function unique(values) {
  return [...new Set(values)].sort();
}

async function readTextIfExists(relativePath) {
  try {
    return await readFile(path.join(ROOT, relativePath), 'utf8');
  } catch {
    return '';
  }
}

export function touchesCommunicationPath(files) {
  return files.some((file) => pathMatchesAny(file, COMMUNICATION_PATHS));
}

// Changed-path ownership applies to every task spec, not just the two
// scenario-bound families. Scenario-less specs (the RC-00..RC-09 convergence
// packages) previously reached only the id/title check in cli.mjs, so their
// declared ownedPaths were inert metadata and any changed path passed. The RC-09
// remediation plan requires each changed path map to exactly one owning package.
export function validateChangedPathOwnership(taskSpec, scenarioSpec, changedFiles = []) {
  if (changedFiles.length === 0) return [];
  const touchedAreas = toArray(taskSpec?.data?.touchedAreas);
  const ownedPaths = [
    ...toArray(taskSpec?.data?.ownedPaths),
    ...toArray(scenarioSpec?.data?.ownedPaths),
  ];
  const allowedPaths = [...touchedAreas, ...ownedPaths];
  if (allowedPaths.length === 0) {
    return [`${taskSpec.path}: changed files present but the spec declares no touchedAreas or ownedPaths`];
  }
  const uncovered = changedFiles.filter((file) => !pathMatchesAny(file, allowedPaths));
  if (uncovered.length === 0) return [];
  return [`${taskSpec.path}: changed files are not covered by touchedAreas or ownedPaths: ${uncovered.join(', ')}`];
}

export function scanBackendCommunicationBoundaryText(file, text) {
  const failures = [];
  const isPageOrComponent = file.startsWith('src/pages/') || file.startsWith('src/components/');

  if (isPageOrComponent && DIRECT_IPC_PATTERN.test(text)) {
    failures.push(`${file}: renderer page/component must not call window.electron.ipcRenderer.invoke directly`);
  }

  if (DIRECT_GATEWAY_HTTP_PATTERN.test(text)) {
    failures.push(`${file}: renderer must not fetch Gateway HTTP directly`);
  }

  if (DIRECT_GATEWAY_WS_PATTERN.test(text)) {
    failures.push(`${file}: renderer must not open Gateway WebSocket connections directly`);
  }

  if (HOST_API_LOCAL_HTTP_PATTERN.test(text)) {
    failures.push(`${file}: renderer must not use the removed Host API localhost server`);
  }

  if (isPageOrComponent && GATEWAY_READY_MUTATION_PATTERN.test(text)) {
    failures.push(`${file}: gatewayReady mutation and refresh gating must stay in stores/main lifecycle code`);
  }

  return failures;
}

export async function scanBackendCommunicationBoundary(files) {
  const failures = [];
  const scanFiles = unique(files).filter((file) => file.startsWith('src/') && /\.(ts|tsx|js|jsx)$/.test(file));

  for (const file of scanFiles) {
    const text = await readTextIfExists(file);
    if (!text) continue;
    failures.push(...scanBackendCommunicationBoundaryText(file, text));
  }

  return failures;
}

export function validateGatewayTaskSpec(taskSpec, scenarioSpec, changedFiles = []) {
  return validateTaskSpec(taskSpec, scenarioSpec, changedFiles, {
    scenarioId: 'gateway-backend-communication',
    taskType: 'runtime-bridge',
    label: 'gateway backend communication',
    requiredProfiles: ['fast', 'comms'],
  });
}

export function validatePluginLifecycleTaskSpec(taskSpec, scenarioSpec, changedFiles = []) {
  return validateTaskSpec(taskSpec, scenarioSpec, changedFiles, {
    scenarioId: 'plugin-lifecycle-management',
    taskType: 'plugin-lifecycle',
    label: 'plugin lifecycle',
    requiredProfiles: ['fast'],
  });
}

function validateTaskSpec(taskSpec, scenarioSpec, changedFiles, options) {
  const failures = [];
  const data = taskSpec.data ?? {};
  const requiredProfiles = toArray(data.requiredProfiles);
  const touchedAreas = toArray(data.touchedAreas);
  const expectedUserBehavior = toArray(data.expectedUserBehavior);
  const acceptance = toArray(data.acceptance);

  for (const field of ['id', 'title', 'scenario', 'taskType', 'intent']) {
    if (!data[field]) failures.push(`${taskSpec.path}: missing required field "${field}"`);
  }

  if (data.scenario !== options.scenarioId) {
    failures.push(`${taskSpec.path}: ${options.label} tasks must set scenario: ${options.scenarioId}`);
  }

  if (data.taskType !== options.taskType) {
    failures.push(`${taskSpec.path}: ${options.label} tasks must set taskType: ${options.taskType}`);
  }

  for (const profile of options.requiredProfiles) {
    if (!requiredProfiles.includes(profile)) {
      failures.push(`${taskSpec.path}: requiredProfiles must include "${profile}"`);
    }
  }

  if (touchedAreas.length === 0) failures.push(`${taskSpec.path}: touchedAreas must declare affected paths`);
  if (expectedUserBehavior.length === 0) failures.push(`${taskSpec.path}: expectedUserBehavior must declare visible behavior`);
  if (acceptance.length === 0) failures.push(`${taskSpec.path}: acceptance must declare completion criteria`);

  if (!data.docs || typeof data.docs !== 'object' || typeof data.docs.required !== 'boolean') {
    failures.push(`${taskSpec.path}: docs.required must be explicitly true or false`);
  }

  if (scenarioSpec) {
    const scenarioProfiles = toArray(scenarioSpec.data?.requiredProfiles);
    for (const profile of scenarioProfiles) {
      if (!requiredProfiles.includes(profile)) {
        failures.push(`${taskSpec.path}: requiredProfiles must include scenario-required profile "${profile}"`);
      }
    }
  }

  failures.push(...validateChangedPathOwnership(taskSpec, scenarioSpec, changedFiles));

  return failures;
}
