import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT, loadRuleSpecs, pathMatchesAny, toArray } from './specs.mjs';

const execFileAsync = promisify(execFile);

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

async function readTextIfExists(relativePath, cwd = ROOT) {
  try {
    return await readFile(path.join(cwd, relativePath), 'utf8');
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

const CACHE_IMPACT_RULE_ID = 'cache-impact-declaration';
const CACHE_IMPACT_LEVEL_RE = /^\s*[>#*_-]*Cache-impact\s*:\s*(none|low|medium|high)\b/im;

/** Mirror check-cache-impact.sh `field_value`: find `Label:` and trim the value. */
function extractFieldValue(body, label) {
  if (typeof body !== 'string' || body.length === 0) return null;
  const line = body.match(new RegExp(`^[\\s>#*_-]*${label}\\s*:`, 'im'));
  if (!line || line.index === undefined) return null;
  const after = body.slice(line.index + line[0].length);
  const value = after.split('\n', 1)[0];
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Extract a valid Cache-impact level from a PR/commit body, or null when absent. */
export function parseCacheImpactLevel(body) {
  if (typeof body !== 'string' || body.length === 0) return null;
  const match = body.match(CACHE_IMPACT_LEVEL_RE);
  return match ? match[1].toLowerCase() : null;
}

function isTodoOrTbd(value) {
  return /^todo(\b|[\s:=-])|^tbd(\b|[\s:=-])/i.test(value);
}

function isInvalidReviewValue(value) {
  return isTodoOrTbd(value) || /^(n\/?a|none)(\b|[\s:=-])/i.test(value);
}

/**
 * Read the declaration source, mirroring the DeepSeek-Reasonix
 * `scripts/check-cache-impact.sh` inputs: PR body env vars/file first, then a
 * repo-root `.cache-impact` convenience file, then the latest commit message.
 */
export async function readCacheImpactBody({ env = process.env, cwd = ROOT } = {}) {
  const fromEnv = env?.CACHE_IMPACT_PR_BODY ?? env?.PR_BODY;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv;
  }
  const bodyFile = env?.CACHE_IMPACT_PR_BODY_FILE;
  if (typeof bodyFile === 'string' && bodyFile.trim()) {
    try {
      return await readFile(path.resolve(cwd, bodyFile), 'utf8');
    } catch {
      // fall through to remaining sources
    }
  }
  const local = await readTextIfExists('.cache-impact', cwd);
  if (local.trim()) {
    return local;
  }
  try {
    const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%B'], {
      cwd,
      encoding: 'utf8',
    });
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Enforce the `cache-impact-declaration` rule, mirroring
 * `scripts/check-cache-impact.sh`: cache-sensitive paths require `Cache-impact:`
 * and `Cache-guard:`; system-prompt-sensitive paths additionally require a
 * `System-prompt-review:` approval note.
 */
export async function validateCacheImpactDeclaration(
  changedFiles,
  { env = process.env, cwd = ROOT } = {},
) {
  if (!changedFiles || changedFiles.length === 0) return [];
  const rules = await loadRuleSpecs();
  const rule = rules.find((candidate) => candidate.data?.id === CACHE_IMPACT_RULE_ID);
  const patterns = toArray(rule?.data?.pathPatterns);
  if (patterns.length === 0) return [];
  const impacted = changedFiles.filter((file) => pathMatchesAny(file, patterns));
  const systemPromptPaths = toArray(rule?.data?.systemPromptPaths);
  const systemPromptImpacted = changedFiles.filter((file) => pathMatchesAny(file, systemPromptPaths));
  // A system-prompt change is itself cache-sensitive, so it also demands the
  // base Cache-impact/Cache-guard lines (matching the reference, where
  // system-prompt-sensitive files are a subset of cache-sensitive files).
  if (impacted.length === 0 && systemPromptImpacted.length === 0) return [];

  const body = await readCacheImpactBody({ env, cwd });
  const failures = [];

  const level = parseCacheImpactLevel(body);
  if (!level) {
    failures.push(
      `cache-impact-declaration: cache-sensitive paths changed but no "Cache-impact: <none|low|medium|high>" declaration was found. ` +
        `Impacted: ${[...impacted, ...systemPromptImpacted].join(', ')}`,
    );
  }

  const guard = extractFieldValue(body, 'Cache-guard');
  if (!guard || isTodoOrTbd(guard)) {
    failures.push(
      `cache-impact-declaration: cache-sensitive paths changed but "Cache-guard: <guard test/command or rationale>" is missing.`,
    );
  }

  if (systemPromptImpacted.length > 0) {
    const review = extractFieldValue(body, 'System-prompt-review');
    if (!review || isInvalidReviewValue(review)) {
      failures.push(
        `cache-impact-declaration: system-prompt-sensitive paths changed but "System-prompt-review: <reviewer/approval>" is missing or unfilled. ` +
          `Impacted: ${systemPromptImpacted.join(', ')}`,
      );
    }
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
