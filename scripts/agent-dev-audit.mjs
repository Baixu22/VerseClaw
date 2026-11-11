#!/usr/bin/env node
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { acceptanceArtifactPath, AGENT_DEV_EVIDENCE_INPUTS } from './lib/acceptance-artifacts.mjs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = acceptanceArtifactPath(ROOT, 'agent-dev-audit');
const OUT_JSON = resolve(OUT_DIR, 'report.json');
const OUT_MD = resolve(OUT_DIR, 'report.md');

const AUDIT_POLICY = {
  schema: 'clawx.agent-dev.audit.v1',
  passScore: 90,
  warnScore: 80,
  maxEvidenceAgeHours: 24,
  maxHistoryEntries: 20,
  hardVetoSeverities: ['fail'],
  statusSemantics: {
    pass: 'Score is at least 90 and no hard-veto findings exist.',
    warn: 'Score is at least 80 and below 90 with no hard-veto findings.',
    fail: 'Score is below 80 or at least one hard-veto finding exists.',
  },
};

const REQUIRED_FULL_GATES = [
  'pnpm run typecheck',
  'pnpm agent-dev:unit',
  'pnpm run build:vite',
  'pnpm test:e2e:agent-dev-quality',
  'pnpm agent-dev:deep-test',
];

const REQUIRED_FAST_PATHS = [
  'pnpm agent-dev:fast',
  'pnpm agent-dev:unit:node',
  'pnpm agent-dev:unit:fast',
  'pnpm run typecheck:agent-dev',
  'pnpm run typecheck:cached',
  'pnpm run test:e2e:agent-dev-quality:smoke',
  'pnpm agent-dev:deep-test:reuse',
  'pnpm agent-dev:deep-test:reuse:full',
];

const DIMENSIONS = [
  {
    id: 'gate-integrity',
    title: 'Gate Integrity',
    maxScore: 20,
    description: 'Full gates remain available, fast paths are additive, and deep-test explains which full gates remain required.',
  },
  {
    id: 'evidence-completeness',
    title: 'Evidence Completeness',
    maxScore: 20,
    description: 'Machine-readable Workbench, deep-test, quality, decision, and trend evidence exist.',
  },
  {
    id: 'coverage-breadth',
    title: 'Coverage Breadth',
    maxScore: 20,
    description: 'Agent Dev has scenario, unit, E2E, contract, i18n, and host-api boundary coverage.',
  },
  {
    id: 'performance-discipline',
    title: 'Performance Discipline',
    maxScore: 20,
    description: 'Latest timing evidence stays within budgets and refuses to treat over-limit runs as passing design evidence.',
  },
  {
    id: 'docs-runbook',
    title: 'Docs And Runbook',
    maxScore: 10,
    description: 'Developer docs explain daily loops, full gates, release evidence, and failure interpretation.',
  },
  {
    id: 'maintainability',
    title: 'Maintainability',
    maxScore: 10,
    description: 'The system avoids parallel registries, has focused unit protection, and keeps generated evidence bounded.',
  },
];

const EVIDENCE_SOURCES = [
  ...AGENT_DEV_EVIDENCE_INPUTS.map((entry) => ({ ...entry, path: `artifacts/${entry.path}`, required: true, generated: true })),
  { id: 'package-scripts', path: 'package.json', required: true, generated: false },
  { id: 'agent-dev-runbook', path: 'docs/agent-dev-control-plane.md', required: true, generated: false },
  { id: 'agent-instructions', path: 'AGENTS.md', required: true, generated: false },
  { id: 'scenario-registry', path: 'shared/agent-dev/scenarios.ts', required: true, generated: false },
  { id: 'regularization-tests', path: 'tests/unit/agent-dev-regularization.test.ts', required: true, generated: false },
];

const AGENT_DEV_SOURCE_PATHS = [
  'AGENTS.md',
  'docs/agent-dev-control-plane.md',
  'package.json',
  'scripts/agent-dev-audit.mjs',
  'scripts/agent-dev-deep-test.mjs',
  'scripts/agent-dev-workbench.mjs',
  'scripts/lib/acceptance-artifacts.mjs',
  'scripts/typecheck-agent-dev.mjs',
  'tests/setup-agent-dev-node.ts',
  'tests/unit/agent-dev-regularization.test.ts',
  'vitest.agent-dev.node.config.ts',
  'shared/agent-dev',
  'shared/host-api/contract.ts',
  'src/lib/host-api.ts',
  'electron/services/agent-dev-api.ts',
];

async function readText(path) {
  const full = path.startsWith('artifacts/') ? acceptanceArtifactPath(ROOT, path.slice('artifacts/'.length)) : resolve(ROOT, path);
  if (!existsSync(full)) return '';
  return await readFile(full, 'utf8');
}

async function readJson(path) {
  const text = await readText(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function collectFiles(root, entry) {
  const absolute = resolve(root, entry);
  if (!existsSync(absolute)) return [];
  const info = await stat(absolute);
  if (!info.isDirectory()) return [absolute];
  const files = [];
  const children = await readdir(absolute, { withFileTypes: true });
  for (const child of children) {
    const childEntry = `${entry}/${child.name}`;
    if (child.isDirectory()) {
      files.push(...await collectFiles(root, childEntry));
    } else if (child.isFile()) {
      files.push(resolve(root, childEntry));
    }
  }
  return files;
}

// Evidence freshness asks: was this evidence regenerated after the sources
// last *changed*? Working-tree mtime cannot answer that in a clean git
// checkout, where every tracked file shares the checkout-time mtime and the
// comparison hard-fails even for evidence committed in the same change set.
// Resolve clean tracked files to their last commit time; dirty or untracked
// files keep their working-tree mtime so the daily loop still hard-fails on
// unrefreshed evidence. When git is unavailable, fall back to mtime.
function runGitText(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function collectGitSourceState(root, relativePaths) {
  if (relativePaths.length === 0) return { dirty: new Set(), times: new Map() };
  const statusOut = runGitText(root, ['status', '--porcelain=v1', '-z', '--', ...relativePaths]);
  if (statusOut == null) return null;
  const dirty = new Set();
  for (const entry of statusOut.split('\u0000')) {
    if (entry.length < 4) continue;
    dirty.add(entry.slice(3));
  }
  const times = new Map();
  const logOut = runGitText(root, ['log', '--no-renames', '--format=commit %cI', '--name-only', '-n', '2000', '--', ...relativePaths]);
  if (logOut != null) {
    // --name-only prints "commit <ISO>\n\n<file>\n" groups; track the last
    // seen commit line instead of relying on blank-line block structure.
    let currentMs = null;
    for (const raw of logOut.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('commit ')) {
        const commitMs = new Date(line.slice(7)).getTime();
        currentMs = Number.isSafeInteger(commitMs) ? commitMs : null;
        continue;
      }
      if (currentMs != null && !times.has(line)) times.set(line, currentMs);
    }
  }
  return { dirty, times };
}

// Decide which timestamp represents "last source change" for one file.
// Clean tracked files use commit time; anything else keeps worktree mtime.
function resolveSourceChangeTimeMs({ path, mtimeMs }, gitState) {
  const key = String(path).replaceAll('\\', '/');
  if (gitState && !gitState.dirty.has(key)) {
    const commitMs = gitState.times.get(key);
    if (Number.isSafeInteger(commitMs)) {
      return { timeMs: commitMs, timeSource: 'git-commit' };
    }
  }
  return { timeMs: mtimeMs, timeSource: 'worktree-mtime' };
}

function relativePathFor(root, file) {
  const rootNorm = root.replaceAll('\\', '/').replace(/\/+$/, '');
  const fileNorm = file.replaceAll('\\', '/');
  return fileNorm.startsWith(`${rootNorm}/`) ? fileNorm.slice(rootNorm.length + 1) : fileNorm;
}

async function newestAgentDevSource() {
  const files = [];
  for (const entry of AGENT_DEV_SOURCE_PATHS) {
    files.push(...await collectFiles(ROOT, entry));
  }
  const relPaths = files.map((file) => relativePathFor(ROOT, file));
  const gitState = collectGitSourceState(ROOT, relPaths);
  let newest = null;
  for (let index = 0; index < files.length; index += 1) {
    const info = await stat(files[index]);
    const resolved = resolveSourceChangeTimeMs({ path: relPaths[index], mtimeMs: info.mtimeMs }, gitState);
    if (!newest || resolved.timeMs > newest.mtimeMs) {
      newest = {
        path: relPaths[index],
        mtime: new Date(resolved.timeMs).toISOString(),
        mtimeMs: resolved.timeMs,
        timeSource: resolved.timeSource,
      };
    }
  }
  return newest;
}

function packageCommand(packageJson, command) {
  return packageJson?.scripts?.[command] ?? '';
}

function includesAll(text, values) {
  return values.every((value) => text.includes(value));
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function extractScenarioIds(registryText) {
  const match = registryText.match(/export const AGENT_DEV_SCENARIOS = \[([\s\S]*?)\] as const/);
  return match ? [...match[1].matchAll(/\{\s*id:\s*'([^']+)'/g)].map((entry) => entry[1]) : [];
}

function priorityForSeverity(severity) {
  if (severity === 'fail') return 'P0';
  if (severity === 'warn') return 'P1';
  return 'P2';
}

function finding(id, severity, message, recommendation, priority = priorityForSeverity(severity)) {
  return { id, severity, priority, message, recommendation };
}

function scoreFromFindings(maxScore, findings) {
  const penalty = findings.reduce((total, item) => {
    if (item.severity === 'fail') return total + 8;
    if (item.severity === 'warn') return total + 3;
    return total + 1;
  }, 0);
  return Math.max(0, maxScore - penalty);
}

function gradeForScore(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function maturityLevelForScore(score, disqualifierCount = 0) {
  if (disqualifierCount > 0) return 'blocked';
  if (score >= 95) return 'release-grade';
  if (score >= 90) return 'review-ready';
  if (score >= 80) return 'daily-loop-ready';
  if (score >= 60) return 'developing';
  return 'immature';
}

function validationCommandsForFinding(findingItem) {
  if (findingItem.id === 'latest-decision-blocked' || findingItem.id.startsWith('performance-limit:')) {
    return [
      'pnpm agent-dev:deep-test --reuse-build --fast-unit --fast-typecheck --smoke-e2e',
      'pnpm agent-dev:audit:report',
    ];
  }
  if (findingItem.id.startsWith('performance-watch:')) {
    return [
      'pnpm agent-dev:fast',
      'pnpm agent-dev:audit:report',
    ];
  }
  if (findingItem.id.includes('typecheck')) {
    return [
      'pnpm run typecheck:agent-dev',
      'pnpm run typecheck',
    ];
  }
  if (findingItem.id.includes('e2e') || findingItem.id.includes('playwright')) {
    return [
      'pnpm run test:e2e:agent-dev-quality:smoke',
      'pnpm run test:e2e:agent-dev-quality:run',
    ];
  }
  if (findingItem.dimension === 'evidence-completeness') {
    return [
      'pnpm agent-dev:workbench',
      'pnpm agent-dev:deep-test:reuse',
      'pnpm agent-dev:audit:report',
    ];
  }
  return [
    'pnpm exec vitest run --maxWorkers=1 tests/unit/agent-dev-regularization.test.ts',
    'pnpm agent-dev:audit:report',
  ];
}

function impactForFinding(findingItem) {
  if (findingItem.severity === 'fail') return 'high';
  if (findingItem.severity === 'warn') return 'medium';
  return 'low';
}

function effortForFinding(findingItem) {
  if (findingItem.id.startsWith('performance-limit:typecheck')) return 'medium';
  if (findingItem.id.startsWith('performance-watch:contract') || findingItem.id.startsWith('performance-watch:i18n')) return 'low';
  if (findingItem.dimension === 'evidence-completeness') return 'low';
  return findingItem.severity === 'fail' ? 'medium' : 'low';
}

function dimensionStatus(dimension) {
  const ratio = dimension.score / dimension.maxScore;
  if (dimension.findings.some((item) => item.severity === 'fail') || ratio < 0.6) return 'fail';
  if (dimension.findings.some((item) => item.severity === 'warn') || ratio < 0.8) return 'warn';
  return 'pass';
}

function evaluateGateIntegrity({ packageJson, deepReport }) {
  const findings = [];
  for (const commandLine of REQUIRED_FULL_GATES) {
    const command = commandLine.replace(/^pnpm (?:run )?/, '');
    const scriptName = command === 'test:e2e:agent-dev-quality' ? 'test:e2e:agent-dev-quality' : command;
    if (!packageCommand(packageJson, scriptName)) {
      findings.push(finding(
        `missing-full-gate:${scriptName}`,
        'fail',
        `Missing full gate script: ${commandLine}.`,
        'Restore the full gate instead of relying on fast-path evidence.',
      ));
    }
  }
  for (const commandLine of REQUIRED_FAST_PATHS) {
    const command = commandLine.replace(/^pnpm (?:run )?/, '');
    const scriptName = command === 'test:e2e:agent-dev-quality:smoke' ? 'test:e2e:agent-dev-quality:smoke' : command;
    if (!packageCommand(packageJson, scriptName)) {
      findings.push(finding(
        `missing-fast-path:${scriptName}`,
        'warn',
        `Missing daily-loop fast path script: ${commandLine}.`,
        'Add the fast path only as an additive command, leaving full gates intact.',
      ));
    }
  }
  const requiredFullGates = deepReport?.decision?.requiredFullGates ?? [];
  if (deepReport && deepReport.decision?.fastPathModes?.length && requiredFullGates.length === 0) {
    findings.push(finding(
      'fast-path-without-required-full-gates',
      'fail',
      'Latest deep-test used fast paths but did not list required full gates.',
      'Ensure deep-test decision.requiredFullGates names every full gate displaced by a fast path.',
    ));
  }
  return findings;
}

function evaluateEvidenceCompleteness({ deepReport, qualityReport, history, workbenchEvidence }) {
  const findings = [];
  if (!workbenchEvidence) {
    findings.push(finding('missing-workbench-evidence', 'fail', 'Workbench evidence.json is missing or unreadable.', 'Run pnpm agent-dev:workbench and keep evidence machine-readable.'));
  }
  if (!deepReport) {
    findings.push(finding('missing-deep-test-report', 'fail', 'Deep-test report.json is missing or unreadable.', 'Run pnpm agent-dev:deep-test or a documented deep-test fast path.'));
  } else {
    if (!deepReport.decision?.status) {
      findings.push(finding('missing-decision', 'fail', 'Deep-test report lacks decision.status.', 'Keep decision.status as the primary CI/Workbench interpretation field.'));
    }
    if (!Array.isArray(deepReport.results) || deepReport.results.length === 0) {
      findings.push(finding('missing-step-results', 'fail', 'Deep-test report lacks step results.', 'Write results[] for every planned gate step, including skipped build reuse steps.'));
    }
    if (!deepReport.results?.some((step) => Object.hasOwn(step, 'skipped'))) {
      findings.push(finding('missing-skipped-field', 'warn', 'Deep-test step results do not expose skipped flags.', 'Keep results[].skipped so downstream tooling can distinguish reuse from missing evidence.'));
    }
  }
  if (!qualityReport) {
    findings.push(finding('missing-quality-report', 'warn', 'Agent Dev quality report is missing.', 'Run deep-test or Agent Dev E2E to refresh artifacts/agent-dev-quality/report.json.'));
  } else if (!qualityReport.decision?.status) {
    findings.push(finding('quality-report-missing-decision', 'warn', 'Quality report lacks the latest deep-test decision.', 'Copy the deep-test decision into the quality report for Workbench indexing.'));
  }
  if (!history) {
    findings.push(finding('missing-history', 'warn', 'Deep-test history.json is missing.', 'Run deep-test once after enabling rolling history evidence.'));
  } else if (!history.trend || !Array.isArray(history.entries)) {
    findings.push(finding('malformed-history', 'warn', 'Deep-test history lacks trend or entries.', 'Keep history.json in the clawx.agent-dev.deep-test-history.v1 shape.'));
  }
  return findings;
}

function parseGeneratedAt(json) {
  const value = json?.generatedAt ?? json?.updatedAt ?? json?.latest?.generatedAt ?? null;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function collectEvidenceInventory(now = new Date()) {
  const items = [];
  const newestSource = await newestAgentDevSource();
  for (const source of EVIDENCE_SOURCES) {
    const absolute = source.generated
      ? acceptanceArtifactPath(ROOT, source.path.slice('artifacts/'.length))
      : resolve(ROOT, source.path);
    const exists = existsSync(absolute);
    let mtime = null;
    let generatedAt = null;
    let ageHours = null;
    let parseable = true;
    if (exists) {
      const info = await stat(absolute);
      mtime = info.mtime.toISOString();
      if (source.generated) {
        try {
          const parsed = JSON.parse(await readFile(absolute, 'utf8'));
          generatedAt = parseGeneratedAt(parsed);
        } catch {
          parseable = false;
        }
      }
      const basis = generatedAt ? new Date(generatedAt) : new Date(mtime);
      ageHours = Number(((now.getTime() - basis.getTime()) / 3_600_000).toFixed(2));
    }
    const generatedBasisMs = generatedAt
      ? new Date(generatedAt).getTime()
      : mtime
        ? new Date(mtime).getTime()
        : null;
    const sourceFresh = !source.generated
      || !exists
      || !parseable
      || !newestSource
      || generatedBasisMs == null
      || newestSource.mtimeMs <= generatedBasisMs;
    items.push({
      ...source,
      exists,
      parseable,
      mtime,
      generatedAt,
      ageHours,
      newestRelevantSource: source.generated ? newestSource : null,
      sourceFresh,
      fresh: exists
        && parseable
        && (!source.generated || ageHours == null || ageHours <= AUDIT_POLICY.maxEvidenceAgeHours)
        && sourceFresh,
    });
  }
  return items;
}

function evaluateEvidenceFreshness({ evidenceInventory }) {
  const findings = [];
  for (const item of evidenceInventory ?? []) {
    if (item.required && !item.exists) {
      findings.push(finding(
        `evidence-missing:${item.id}`,
        'fail',
        `Required evidence source is missing: ${item.path}.`,
        'Refresh the Agent Dev evidence chain before trusting the audit score.',
      ));
    } else if (item.required && !item.parseable) {
      findings.push(finding(
        `evidence-unreadable:${item.id}`,
        'fail',
        `Required evidence source is not parseable: ${item.path}.`,
        'Repair or regenerate the evidence artifact.',
      ));
    } else if (item.generated && item.ageHours != null && item.ageHours > AUDIT_POLICY.maxEvidenceAgeHours) {
      findings.push(finding(
        `evidence-stale:${item.id}`,
        'fail',
        `${item.path} is ${item.ageHours}h old, beyond the ${AUDIT_POLICY.maxEvidenceAgeHours}h freshness window.`,
        'Refresh Workbench, deep-test, quality, and audit evidence before final review.',
      ));
    } else if (item.generated && item.sourceFresh === false) {
      findings.push(finding(
        `evidence-source-newer:${item.id}`,
        'fail',
        `${item.path} is older than relevant Agent Dev source ${item.newestRelevantSource?.path ?? 'unknown'}.`,
        'Regenerate Agent Dev Workbench, deep-test, quality, and audit evidence after changing Agent Dev control-plane files.',
      ));
    }
  }
  return findings;
}

function evaluateCoverageBreadth({ packageJson, registryText, workbenchEvidence, docsText }) {
  const findings = [];
  const scenarioIds = extractScenarioIds(registryText);
  if (scenarioIds.length < 10) {
    findings.push(finding('low-scenario-count', 'warn', `Only ${scenarioIds.length} Agent Dev scenarios are registered.`, 'Keep expanding shared/agent-dev/scenarios.ts with reviewed user-visible scenarios.'));
  }
  const missingFacade = workbenchEvidence?.hostApi?.missingFacadeActions ?? [];
  const missingService = workbenchEvidence?.hostApi?.missingServiceActions ?? [];
  if (missingFacade.length || missingService.length) {
    findings.push(finding(
      'host-api-gaps',
      'fail',
      `Workbench evidence reports host-api gaps: facade=${missingFacade.length}, service=${missingService.length}.`,
      'Repair shared/host-api/contract.ts, src/lib/host-api.ts, and electron/services alignment before relying on Agent Dev evidence.',
    ));
  }
  for (const scriptName of ['contract:check', 'i18n:lint', 'agent-dev:unit', 'agent-dev:unit:fast', 'test:e2e:agent-dev-quality', 'test:e2e:agent-dev-quality:smoke']) {
    if (!packageCommand(packageJson, scriptName)) {
      findings.push(finding(`missing-coverage-script:${scriptName}`, 'fail', `Missing coverage command ${scriptName}.`, 'Restore the coverage entry point and document it in the gate matrix.'));
    }
  }
  if (!docsText.includes('shared/agent-dev/scenarios.ts')) {
    findings.push(finding('single-registry-not-documented', 'warn', 'Docs do not identify shared/agent-dev/scenarios.ts as source of truth.', 'Document the single scenario registry in the Agent Dev runbook.'));
  }
  return findings;
}

function evaluatePerformanceDiscipline({ deepReport }) {
  const findings = [];
  if (!deepReport) {
    findings.push(finding('no-performance-evidence', 'fail', 'No latest deep-test timing report is available.', 'Run pnpm agent-dev:deep-test or a documented fast path before scoring performance.'));
    return findings;
  }
  if (deepReport.decision?.status === 'blocked') {
    findings.push(finding(
      'latest-decision-blocked',
      'fail',
      `Latest deep-test decision is blocked: ${deepReport.decision.reason}`,
      'Treat this as an audit failure until limit steps are optimized or the budget is intentionally revised with evidence.',
    ));
  } else if (deepReport.decision?.status === 'needs-full-gate') {
    findings.push(finding(
      'latest-needs-full-gate',
      'warn',
      'Latest deep-test is daily-loop evidence and still requires full gates.',
      'Run decision.requiredFullGates before PR/release review.',
    ));
  }
  const limits = deepReport.performanceLimits ?? [];
  for (const entry of limits.filter((item) => item.severity === 'limit')) {
    findings.push(finding(
      `performance-limit:${entry.id}`,
      'fail',
      `${entry.id} exceeded hard limit: ${entry.durationMs}ms > ${entry.limitMs}ms.`,
      entry.mitigation ?? 'Optimize the step or split fast/full coverage before expanding gates.',
    ));
  }
  for (const entry of limits.filter((item) => item.severity === 'watch').slice(0, 5)) {
    findings.push(finding(
      `performance-watch:${entry.id}`,
      'warn',
      `${entry.id} exceeded target: ${entry.durationMs}ms > ${entry.targetMs}ms.`,
      entry.mitigation ?? 'Keep watching this step in rolling history.',
    ));
  }
  return findings;
}

function evaluateDocsRunbook({ docsText, agentsText, readmeText }) {
  const findings = [];
  const requiredDocs = [
    'decision.status',
    'decision.requiredFullGates',
    'pnpm agent-dev:deep-test:reuse',
    'pnpm agent-dev:unit:fast',
    'pnpm run typecheck:agent-dev',
    'pnpm run typecheck:cached',
    'pnpm run test:e2e:agent-dev-quality:smoke',
    'pnpm agent-dev:deep-test:reuse:full',
    'Release evidence',
  ];
  for (const text of requiredDocs) {
    if (!docsText.includes(text)) {
      findings.push(finding(`missing-doc:${text}`, 'warn', `Runbook does not mention ${text}.`, 'Keep the gate matrix complete and explicit.'));
    }
  }
  if (!agentsText.includes('decision.status')) {
    findings.push(finding('agents-missing-decision', 'warn', 'AGENTS.md does not describe deep-test decision semantics.', 'Keep AGENTS.md aligned with the report fields agents must interpret.'));
  }
  if (!readmeText.includes('decision')) {
    findings.push(finding('readme-missing-decision', 'info', 'README does not mention deep-test decision evidence.', 'Mention the audit surface at a high level and point to the runbook.'));
  }
  return findings;
}

function evaluateMaintainability({ regularizationTestText, deepTestText, workbenchText, history }) {
  const findings = [];
  if (!regularizationTestText.includes('summarizes deep-test decisions')) {
    findings.push(finding('decision-tests-missing', 'fail', 'Unit tests do not protect deep-test decision semantics.', 'Add focused tests for full, fast, and blocked decisions.'));
  }
  if (!regularizationTestText.includes('same-mode trend summaries')) {
    findings.push(finding('history-tests-missing', 'warn', 'Unit tests do not protect deep-test history trend semantics.', 'Add focused trend/history tests.'));
  }
  if (!deepTestText.includes('slice(-20)')) {
    findings.push(finding('history-not-bounded', 'warn', 'Deep-test history does not appear bounded.', 'Keep rolling evidence bounded to avoid artifact growth.'));
  }
  if (!workbenchText.includes('shared/agent-dev/scenarios.ts')) {
    findings.push(finding('workbench-registry-drift-risk', 'fail', 'Workbench script may not read the shared scenario registry.', 'Keep Workbench indexed against shared/agent-dev/scenarios.ts only.'));
  }
  if ((history?.entries?.length ?? 0) > 20) {
    findings.push(finding('history-too-large', 'warn', 'Deep-test history has more than 20 entries.', 'Trim rolling history to the configured maximum.'));
  }
  return findings;
}

function buildDimension(id, findings) {
  const spec = DIMENSIONS.find((dimension) => dimension.id === id);
  const score = scoreFromFindings(spec.maxScore, findings);
  const dimension = {
    ...spec,
    score,
    findings,
  };
  dimension.status = dimensionStatus(dimension);
  return dimension;
}

function sortFindings(findings) {
  const priorityRank = { P0: 0, P1: 1, P2: 2 };
  const severityRank = { fail: 0, warn: 1, info: 2 };
  return [...findings].sort((left, right) => (
    (priorityRank[left.priority] ?? 3) - (priorityRank[right.priority] ?? 3)
    || (severityRank[left.severity] ?? 3) - (severityRank[right.severity] ?? 3)
    || left.id.localeCompare(right.id)
  ));
}

function enrichFinding(item) {
  return {
    ...item,
    impact: impactForFinding(item),
    effort: effortForFinding(item),
    validationCommands: validationCommandsForFinding(item),
  };
}

function explainDimensionScore(dimension) {
  const deducted = dimension.maxScore - dimension.score;
  return {
    id: dimension.id,
    title: dimension.title,
    score: dimension.score,
    maxScore: dimension.maxScore,
    deducted,
    status: dimension.status,
    reason: deducted === 0
      ? 'No findings deducted points for this dimension.'
      : `${dimension.findings.length} finding(s) deducted ${deducted} point(s).`,
    findings: dimension.findings.map((item) => ({
      id: item.id,
      severity: item.severity,
      estimatedPenalty: item.severity === 'fail' ? 8 : item.severity === 'warn' ? 3 : 1,
      recommendation: item.recommendation,
    })),
  };
}

function summarizeConfidence({ dimensions, evidenceInventory }) {
  const evidenceFindings = dimensions.find((dimension) => dimension.id === 'evidence-completeness')?.findings ?? [];
  const missingOrUnreadable = evidenceFindings.some((item) => item.id.startsWith('evidence-missing:') || item.id.startsWith('evidence-unreadable:'));
  const staleCount = evidenceFindings.filter((item) => item.id.startsWith('evidence-stale:')).length;
  const generatedSources = evidenceInventory?.filter((item) => item.generated) ?? [];
  const freshGeneratedCount = generatedSources.filter((item) => item.fresh).length;
  if (missingOrUnreadable) {
    return {
      level: 'low',
      reason: 'At least one required evidence artifact is missing or unreadable.',
      freshGeneratedCount,
      generatedSourceCount: generatedSources.length,
      staleGeneratedCount: staleCount,
    };
  }
  if (staleCount > 0) {
    return {
      level: 'medium',
      reason: `${staleCount} generated evidence artifact(s) are stale.`,
      freshGeneratedCount,
      generatedSourceCount: generatedSources.length,
      staleGeneratedCount: staleCount,
    };
  }
  return {
    level: 'high',
    reason: 'Required generated evidence is present, parseable, and within the freshness window.',
    freshGeneratedCount,
    generatedSourceCount: generatedSources.length,
    staleGeneratedCount: 0,
  };
}

function buildAuditReport(inputs) {
  const dimensions = [
    buildDimension('gate-integrity', evaluateGateIntegrity(inputs)),
    buildDimension('evidence-completeness', [
      ...evaluateEvidenceCompleteness(inputs),
      ...evaluateEvidenceFreshness(inputs),
    ]),
    buildDimension('coverage-breadth', evaluateCoverageBreadth(inputs)),
    buildDimension('performance-discipline', evaluatePerformanceDiscipline(inputs)),
    buildDimension('docs-runbook', evaluateDocsRunbook(inputs)),
    buildDimension('maintainability', evaluateMaintainability(inputs)),
  ];
  const totalScore = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
  const maxScore = dimensions.reduce((sum, dimension) => sum + dimension.maxScore, 0);
  const disqualifiers = dimensions.flatMap((dimension) => (
    dimension.findings
      .filter((item) => item.severity === 'fail')
      .map((item) => ({ dimension: dimension.id, ...item }))
  ));
  const failedDimensions = dimensions.filter((dimension) => dimension.status === 'fail');
  const status = disqualifiers.length || totalScore < AUDIT_POLICY.warnScore
    ? 'fail'
    : totalScore < AUDIT_POLICY.passScore
      ? 'warn'
      : 'pass';
  const prioritizedFindings = sortFindings(dimensions.flatMap((dimension) => (
    dimension.findings.map((item) => ({ dimension: dimension.id, ...item }))
  ))).map(enrichFinding);
  const scoreBreakdown = dimensions.map(explainDimensionScore);
  return {
    schema: AUDIT_POLICY.schema,
    generatedAt: new Date().toISOString(),
    policy: AUDIT_POLICY,
    status,
    grade: gradeForScore(totalScore),
    maturityLevel: maturityLevelForScore(totalScore, disqualifiers.length),
    confidence: summarizeConfidence({ dimensions, evidenceInventory: inputs.evidenceInventory }),
    totalScore,
    maxScore,
    summary: {
      pass: dimensions.filter((dimension) => dimension.status === 'pass').length,
      warn: dimensions.filter((dimension) => dimension.status === 'warn').length,
      fail: failedDimensions.length,
      disqualifierCount: disqualifiers.length,
    },
    dimensions,
    scoreBreakdown,
    rubric: DIMENSIONS,
    evidenceInventory: inputs.evidenceInventory ?? [],
    prioritizedFindings,
    disqualifiers,
    recommendations: [
      ...new Set(prioritizedFindings.map((item) => item.recommendation)),
    ].filter(Boolean),
  };
}

function renderMarkdown(report) {
  const rows = report.dimensions.map((dimension) => (
    `| ${dimension.status} | ${dimension.title} | ${dimension.score}/${dimension.maxScore} | ${dimension.findings.length} |`
  )).join('\n');
  const findings = report.dimensions.flatMap((dimension) => (
    dimension.findings.map((item) => `- **${dimension.title} / ${item.severity}**: ${item.message} ${item.recommendation}`)
  )).join('\n') || '- No findings.';
  const recs = report.recommendations.map((item) => `- ${item}`).join('\n') || '- No recommendations.';
  const priorityRows = report.prioritizedFindings.slice(0, 12).map((item) => (
    `| ${item.priority} | ${item.severity} | ${item.dimension} | ${item.id} | ${item.message} |`
  )).join('\n') || '| - | - | - | - | No findings. |';
  const evidenceRows = report.evidenceInventory.map((item) => (
    `| ${item.fresh ? 'fresh' : 'attention'} | ${item.id} | ${item.path} | ${item.exists ? 'yes' : 'no'} | ${item.generatedAt ?? item.mtime ?? '-'} | ${item.ageHours ?? '-'} | ${item.sourceFresh === false ? item.newestRelevantSource?.path ?? 'yes' : 'no'} |`
  )).join('\n');
  const scoreRows = report.scoreBreakdown.map((item) => (
    `| ${item.status} | ${item.title} | ${item.score}/${item.maxScore} | ${item.deducted} | ${item.reason} |`
  )).join('\n');
  return `# Agent Dev Audit

Generated: ${report.generatedAt}

Status: ${report.status}

Grade: ${report.grade}

Maturity: ${report.maturityLevel}

Confidence: ${report.confidence.level} - ${report.confidence.reason}

Score: ${report.totalScore}/${report.maxScore}

Policy: pass >= ${report.policy.passScore}, warn >= ${report.policy.warnScore}, generated evidence freshness <= ${report.policy.maxEvidenceAgeHours}h. Hard veto findings force fail.

## Dimensions

| Status | Dimension | Score | Findings |
|---|---|---:|---:|
${rows}

## Priority Findings

| Priority | Severity | Dimension | Id | Message |
|---|---|---|---|---|
${priorityRows}

## Score Breakdown

| Status | Dimension | Score | Deducted | Reason |
|---|---|---:|---:|---|
${scoreRows}

## Findings

${findings}

## Evidence Inventory

| Status | Source | Path | Exists | Timestamp | Age hours | Newer source |
|---|---|---|---|---|---:|---|
${evidenceRows}

## Recommendations

${recs}
`;
}

function parseAuditArgs(argv = process.argv.slice(2)) {
  return {
    noFail: argv.includes('--no-fail'),
  };
}

async function collectInputs() {
  const [
    packageJson,
    deepReport,
    qualityReport,
    history,
    workbenchEvidence,
    registryText,
    docsText,
    agentsText,
    readmeText,
    regularizationTestText,
    deepTestText,
    workbenchText,
    evidenceInventory,
  ] = await Promise.all([
    readJson('package.json'),
    readJson('artifacts/agent-dev-deep-test/report.json'),
    readJson('artifacts/agent-dev-quality/report.json'),
    readJson('artifacts/agent-dev-deep-test/history.json'),
    readJson('artifacts/agent-dev-workbench/evidence.json'),
    readText('shared/agent-dev/scenarios.ts'),
    readText('docs/agent-dev-control-plane.md'),
    readText('AGENTS.md'),
    readText('README.md'),
    readText('tests/unit/agent-dev-regularization.test.ts'),
    readText('scripts/agent-dev-deep-test.mjs'),
    readText('scripts/agent-dev-workbench.mjs'),
    collectEvidenceInventory(),
  ]);
  return {
    packageJson,
    deepReport,
    qualityReport,
    history,
    workbenchEvidence,
    registryText,
    docsText,
    agentsText,
    readmeText,
    regularizationTestText,
    deepTestText,
    workbenchText,
    evidenceInventory,
  };
}

async function main() {
  const options = parseAuditArgs();
  const report = buildAuditReport(await collectInputs());
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(OUT_MD, renderMarkdown(report), 'utf8');
  console.log(JSON.stringify({
    status: report.status,
    grade: report.grade,
    totalScore: report.totalScore,
    maxScore: report.maxScore,
    output: OUT_JSON,
    markdown: OUT_MD,
    disqualifiers: report.disqualifiers,
  }, null, 2));
  if (report.status === 'fail' && !options.noFail) process.exitCode = 1;
}

export {
  DIMENSIONS,
  REQUIRED_FAST_PATHS,
  REQUIRED_FULL_GATES,
  buildAuditReport,
  collectGitSourceState,
  resolveSourceChangeTimeMs,

  collectEvidenceInventory,
  evaluateCoverageBreadth,
  evaluateDocsRunbook,
  evaluateEvidenceCompleteness,
  evaluateGateIntegrity,
  evaluateMaintainability,
  evaluatePerformanceDiscipline,
  gradeForScore,
  maturityLevelForScore,
  parseAuditArgs,
};

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
