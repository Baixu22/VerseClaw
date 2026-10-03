#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_ROOT = 'artifacts';
const DONE_CLASS_RE = /^done(?:\s*\(|$)/iu;
const VERIFIED_ENGINEERING_RE = /^verified-engineering\s*\(/iu;
const PLACEHOLDER_VALUE_RE = /^(?:0|false|missing|none|null|no|n\/a|unknown|required|placeholder|fixture|synthetic|automated|agent(?:-|\s)?surrogate|todo|tbd|test(?:-|\s)?(?:fixture|value))$/iu;
const HUMAN_FIELD_NAMES = new Set([
  'human',
  'humanevidence',
  'humanrun',
  'humanruns',
  'humanqualifyingruns',
  'humanliveruns',
  'livehumanruns',
  'humancanaryruns',
  'humansoakruns',
  'humansoakdays',
  'namedhumanoperator',
  'humanoperator',
  'humanapproval',
  'humanapprovals',
  'humanreview',
  'humanreviewer',
  'humanwitness',
]);
const HUMAN_IDENTITY_KEYS = new Set(['kind', 'type', 'role', 'actortype', 'operatortype', 'evidenceclass']);
const HUMAN_ACTOR_KEYS = new Set(['actor', 'operator', 'approver', 'reviewer', 'witness', 'humanoperator', 'humanwitness']);
const HUMAN_IDENTIFIER_KEYS = new Set(['id', 'name', 'subject', 'actorid', 'operatorid', 'approverid', 'reviewerid', 'witnessid']);
const HUMAN_COUNT_KEYS = new Set([
  'count',
  'days',
  'durationdays',
  'humancanaryruns',
  'humanliveruns',
  'humanqualifyingruns',
  'humansoakdays',
  'humansoakruns',
  'liveruns',
  'runs',
]);
const HUMAN_RESULT_KEYS = new Set(['approved', 'available', 'passed', 'present', 'recorded', 'verified']);
const HUMAN_STATUS_KEYS = new Set(['status', 'result', 'outcome']);
const NON_HUMAN_EVIDENCE_KEYS = new Set(['agent', 'automated', 'bot', 'fixture', 'humanequivalent', 'surrogate', 'synthetic']);
const ARTIFACT_IDENTITY_KEYS = new Set([
  'artifactid',
  'artifactkey',
  'evidencefor',
  'forartifact',
  'runid',
  'surfaceid',
  'taskid',
]);
const STABLE_ITEM_ID_KEYS = ['artifactId', 'artifactKey', 'evidenceId', 'id', 'key', 'name', 'runId', 'sampleId', 'surfaceId', 'taskId'];

function toPosix(value) {
  return value.replaceAll('\\', '/');
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function jsonPath(parent, segment) {
  return `${parent}/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

function normalizeKey(key) {
  return key.toLowerCase().replaceAll(/[-_\s]/gu, '');
}

function isPositiveIdentifier(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text.length > 0 && !PLACEHOLDER_VALUE_RE.test(text);
}

function isPositiveCountScalar(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/u.test(value.trim()) && Number(value) > 0;
}

function isPositiveResult(value) {
  if (value === true) return true;
  if (isPositiveCountScalar(value)) return true;
  if (typeof value !== 'string') return false;
  return /^(?:pass(?:ed)?|success(?:ful)?|ok|yes|true|approved|complete(?:d)?|verified|recorded)$/iu.test(value.trim());
}

function hasNonHumanIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (HUMAN_IDENTITY_KEYS.has(normalizedKey) && typeof nested === 'string' && /\b(?:agent|automated|bot|surrogate)\b/iu.test(nested)) {
      return true;
    }
  }
  return false;
}

function hasNonHumanIdentityDeep(value) {
  if (!value || typeof value !== 'object') return false;
  if (hasNonHumanIdentity(value)) return true;
  if (!Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = normalizeKey(key);
      if (NON_HUMAN_EVIDENCE_KEYS.has(normalizedKey) && isPositiveResult(nested)) return true;
    }
  }
  return Object.values(value).some((nested) => hasNonHumanIdentityDeep(nested));
}

function hasHumanIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || hasNonHumanIdentity(value)) return false;
  let human = false;
  let identifier = false;
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (HUMAN_IDENTITY_KEYS.has(normalizedKey) && typeof nested === 'string') {
      if (/\bhuman\b/iu.test(nested) && !/\b(?:agent|automated|bot|surrogate)\b/iu.test(nested)) human = true;
    }
    if (HUMAN_IDENTIFIER_KEYS.has(normalizedKey) && isPositiveIdentifier(nested)) identifier = true;
  }
  return human && identifier;
}

function hasHumanActor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || hasNonHumanIdentityDeep(value)) return false;
  if (hasHumanIdentity(value)) return true;
  return Object.entries(value).some(([key, nested]) => (
    HUMAN_ACTOR_KEYS.has(normalizeKey(key)) && hasHumanIdentity(nested)
  ));
}

function hasPositiveObservation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalizedKey = normalizeKey(key);
    if (HUMAN_COUNT_KEYS.has(normalizedKey)) return isPositiveCountScalar(nested);
    if (HUMAN_RESULT_KEYS.has(normalizedKey)) return isPositiveResult(nested);
    if (HUMAN_STATUS_KEYS.has(normalizedKey)) return isPositiveResult(nested);
    return false;
  });
}

function hasPositiveHumanEvidenceRecord(value) {
  if (Array.isArray(value)) {
    return value.length > 0 && value.some((item) => hasPositiveHumanEvidenceRecord(item));
  }
  if (!value || typeof value !== 'object' || hasNonHumanIdentityDeep(value)) return false;
  return hasHumanActor(value) && hasPositiveObservation(value);
}

/** Return true only for structured, positive human evidence. */
export function hasHumanEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).some(([key, nested]) => (
    HUMAN_FIELD_NAMES.has(normalizeKey(key)) && hasPositiveHumanEvidenceRecord(nested)
  ));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value)
    .filter(([key]) => key !== 'completionClass')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`;
}

function stableArraySegment(item, parentStablePath, occurrences) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    for (const key of STABLE_ITEM_ID_KEYS) {
      const value = item[key];
      if (isPositiveIdentifier(value)) {
        return `${parentStablePath}/@${key}=${JSON.stringify(String(value).trim())}`;
      }
    }
  }
  const fingerprint = stableStringify(item);
  const occurrence = occurrences.get(fingerprint) ?? 0;
  occurrences.set(fingerprint, occurrence + 1);
  return `${parentStablePath}/#${fingerprint}~${occurrence}`;
}

export function findCompletionClassEntries(document, file = '') {
  const entries = [];
  function visit(value, currentPath, currentStablePath) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      const occurrences = new Map();
      value.forEach((item, index) => {
        const stablePath = stableArraySegment(item, currentStablePath, occurrences);
        visit(item, jsonPath(currentPath, index), stablePath);
      });
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = jsonPath(currentPath, key);
      const nestedStablePath = `${currentStablePath}/${key}`;
      if (key === 'completionClass') {
        entries.push({ file, jsonPath: nestedPath, identity: currentStablePath || nestedPath, value: nested });
      }
      visit(nested, nestedPath, nestedStablePath);
    }
  }
  visit(document, '', '');
  return entries;
}

export function selectNewCompletionClassEntries(currentEntries, baselineEntries = []) {
  const baselineByIdentity = new Map();
  for (const entry of baselineEntries) {
    const identity = entry.identity ?? entry.jsonPath;
    const values = baselineByIdentity.get(identity) ?? [];
    values.push(entry.value);
    baselineByIdentity.set(identity, values);
  }
  return currentEntries.filter((entry) => {
    const identity = entry.identity ?? entry.jsonPath;
    const values = baselineByIdentity.get(identity);
    if (!values) return true;
    const match = values.findIndex((value) => value === entry.value);
    if (match < 0) return true;
    values.splice(match, 1);
    return false;
  });
}

export function lintCompletionClassValues(entries) {
  const failures = [];
  for (const entry of entries) {
    if (typeof entry.value !== 'string') {
      failures.push(`${entry.file}${entry.jsonPath}: completionClass must be a string`);
      continue;
    }
    const value = entry.value.trim();
    if (VERIFIED_ENGINEERING_RE.test(value) || !DONE_CLASS_RE.test(value)) continue;
    if (!entry.hasHumanEvidence) {
      failures.push(`${entry.file}${entry.jsonPath}: new ${JSON.stringify(value)} requires positive human evidence in the same artifact directory`);
    }
  }
  return { ok: failures.length === 0, failures, checked: entries.length };
}

function resolveArtifactFile(root, input) {
  const rootPath = path.resolve(root);
  const artifactPath = path.resolve(rootPath, ARTIFACT_ROOT);
  const absolute = path.resolve(rootPath, input);
  if (!isWithin(artifactPath, absolute) || path.extname(absolute).toLowerCase() !== '.json') {
    throw new Error(`expected a JSON file under ${ARTIFACT_ROOT}/: ${input}`);
  }
  return {
    absolute,
    relative: toPosix(path.relative(rootPath, absolute)),
  };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function collectArtifactIdentities(value, identities = new Map()) {
  if (!value || typeof value !== 'object') return identities;
  if (Array.isArray(value)) {
    value.forEach((item) => collectArtifactIdentities(item, identities));
    return identities;
  }
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (ARTIFACT_IDENTITY_KEYS.has(normalizedKey) && isPositiveIdentifier(nested)) {
      identities.set(normalizedKey, String(nested).trim());
    }
    collectArtifactIdentities(nested, identities);
  }
  return identities;
}

function identitiesMatch(targetDocument, evidenceDocument) {
  const target = collectArtifactIdentities(targetDocument);
  const evidence = collectArtifactIdentities(evidenceDocument);
  for (const [key, value] of target) {
    if (evidence.get(key) === value) return true;
  }
  return false;
}

function directoryHasHumanEvidence(directory, currentDocument, currentFile, cache) {
  if (hasHumanEvidence(currentDocument)) return true;
  const identity = [...collectArtifactIdentities(currentDocument)].map(([key, value]) => `${key}=${value}`).sort().join('|');
  if (!identity) return false;
  const cacheKey = `${directory}|${identity}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  let found = false;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') continue;
    const siblingPath = path.join(directory, entry.name);
    if (toPosix(siblingPath) === toPosix(currentFile)) continue;
    try {
      const siblingDocument = readJsonFile(siblingPath);
      if (hasHumanEvidence(siblingDocument) && identitiesMatch(currentDocument, siblingDocument)) {
        found = true;
        break;
      }
    } catch {
      // An unrelated sibling does not make the completion-class check less safe.
    }
  }
  cache.set(cacheKey, found);
  return found;
}

export function lintArtifactCompletionClasses({
  root = REPO_ROOT,
  files = [],
  baselineDocuments = new Map(),
} = {}) {
  const currentEntries = [];
  const failures = [];
  let historicalEntriesIgnored = 0;
  const evidenceCache = new Map();

  for (const input of files) {
    let resolved;
    try {
      resolved = resolveArtifactFile(root, input);
    } catch (error) {
      failures.push(String(error.message ?? error));
      continue;
    }

    let currentDocument;
    try {
      currentDocument = readJsonFile(resolved.absolute);
    } catch (error) {
      failures.push(`${resolved.relative}: invalid JSON (${String(error.message ?? error)})`);
      continue;
    }

    const current = findCompletionClassEntries(currentDocument, resolved.relative);
    const baseline = baselineDocuments.has(resolved.relative)
      ? findCompletionClassEntries(baselineDocuments.get(resolved.relative), resolved.relative)
      : [];
    const added = selectNewCompletionClassEntries(current, baseline);
    historicalEntriesIgnored += current.length - added.length;
    if (added.length === 0) continue;

    const evidence = directoryHasHumanEvidence(
      path.dirname(resolved.absolute),
      currentDocument,
      resolved.absolute,
      evidenceCache,
    );
    for (const entry of added) currentEntries.push({ ...entry, hasHumanEvidence: evidence });
  }

  const result = lintCompletionClassValues(currentEntries);
  return {
    ok: failures.length === 0 && result.ok,
    files,
    entries: currentEntries,
    checked: result.checked,
    historicalEntriesIgnored,
    failures: [...failures, ...result.failures],
  };
}

function gitOutput(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

function parseGitNameStatus(output) {
  const tokens = output.split('\0').filter(Boolean);
  const records = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status) continue;
    if (status.startsWith('R') || status.startsWith('C')) {
      const baselinePath = tokens[index++];
      const currentPath = tokens[index++];
      if (baselinePath && currentPath) records.push({ path: toPosix(currentPath), baselinePath: toPosix(baselinePath) });
      continue;
    }
    const currentPath = tokens[index++];
    if (currentPath) records.push({ path: toPosix(currentPath), baselinePath: toPosix(currentPath) });
  }
  return records;
}

function baseRefTime(root, baseRef) {
  const timestamp = gitOutput(root, ['show', '-s', '--format=%cI', baseRef]).trim();
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : null;
}

function changedArtifactJsonFileRecords(root = REPO_ROOT, baseRef = 'HEAD') {
  const tracked = gitOutput(root, [
    'diff', '--name-status', '-z', '--diff-filter=AMRTUXB', baseRef, '--', ARTIFACT_ROOT,
  ]);
  const untracked = gitOutput(root, [
    'ls-files', '--others', '--exclude-standard', '-z', '--', ARTIFACT_ROOT,
  ]);
  const ignored = gitOutput(root, [
    'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ARTIFACT_ROOT,
  ]);
  const since = baseRefTime(root, baseRef);
  const records = [
    ...parseGitNameStatus(tracked),
    ...untracked.split('\0').filter(Boolean).map((file) => ({ path: toPosix(file), baselinePath: null })),
    ...ignored.split('\0').filter(Boolean)
      .filter((file) => since === null || fs.statSync(path.resolve(root, file)).mtimeMs > since)
      .map((file) => ({ path: toPosix(file), baselinePath: null })),
  ];
  const byPath = new Map(records.map((record) => [record.path, record]));
  return [...byPath.values()]
    .filter((record) => path.extname(record.path).toLowerCase() === '.json')
    .filter((record) => fs.existsSync(path.resolve(root, record.path)));
}

export function changedArtifactJsonFiles(root = REPO_ROOT, baseRef = 'HEAD') {
  return changedArtifactJsonFileRecords(root, baseRef)
    .map((record) => record.path)
    .sort();
}

function readGitBaseline(root, baseRef, files, baselinePaths = new Map()) {
  const baselineDocuments = new Map();
  for (const file of files) {
    const baselinePath = baselinePaths.get(file) ?? file;
    try {
      baselineDocuments.set(file, JSON.parse(gitOutput(root, ['show', `${baseRef}:${baselinePath}`])));
    } catch {
      // A missing git blob means this file is new and all of its classes are new.
    }
  }
  return baselineDocuments;
}

function parseArgs(args) {
  const options = { root: REPO_ROOT, baseRef: 'HEAD', files: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { ...options, help: true };
    if (arg === '--root' || arg === '--base' || arg === '--base-ref' || arg === '--since') {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      if (arg === '--root') options.root = path.resolve(value);
      else options.baseRef = value;
      index += 1;
      continue;
    }
    if (arg === '--files') {
      while (index + 1 < args.length && !args[index + 1].startsWith('--')) {
        options.files.push(args[index + 1]);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    options.files.push(arg);
  }
  return options;
}

export function runCli(args = process.argv.slice(2), io = console) {
  try {
    const options = parseArgs(args);
    if (options.help) {
      io.log('Usage: node scripts/lint-artifact-completion-class.mjs [--base REF] [--root DIR] [--files PATH ...]');
      return 0;
    }
    const records = options.files.length > 0
      ? options.files.map((file) => ({ path: resolveArtifactFile(options.root, file).relative, baselinePath: null }))
      : changedArtifactJsonFileRecords(options.root, options.baseRef);
    const files = records.map((record) => record.path);
    const baselinePaths = new Map(records.map((record) => [record.path, record.baselinePath]));
    const report = lintArtifactCompletionClasses({
      root: options.root,
      files,
      baselineDocuments: readGitBaseline(options.root, options.baseRef, files, baselinePaths),
    });
    for (const failure of report.failures) io.error(`FAIL ${failure}`);
    io.log(`artifact completionClass lint: files=${files.length} new=${report.checked} historicalIgnored=${report.historicalEntriesIgnored}`);
    if (!report.ok) {
      io.error(`artifact completionClass lint: FAILED (${report.failures.length})`);
      return 1;
    }
    io.log('artifact completionClass lint: OK');
    return 0;
  } catch (error) {
    io.error(`FAIL ${String(error.message ?? error)}`);
    return 1;
  }
}

if (isMainEntrypoint(import.meta.url)) {
  process.exitCode = runCli();
}
