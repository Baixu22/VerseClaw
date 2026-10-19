import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OUTPUT_NAME = 'real-runtime-validation-standard-report.json';

function pad(value) {
  return String(value).padStart(2, '0');
}

export function createRunId(date = new Date()) {
  return [
    'run',
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`,
  ].join('-');
}

function statusFromCounts(passCount, total) {
  if (total <= 0) return 'fail';
  if (passCount === total) return 'pass';
  if (passCount === 0) return 'fail';
  return 'partial';
}

function normalizeStatusPath(line) {
  return line.slice(3).trim().replace(/\\/g, '/');
}

function isSystemMetadataStatusLine(line) {
  const path = normalizeStatusPath(line);
  return path === '.verse-claw' || path.startsWith('.verse-claw/');
}

export function splitWorkspaceStatusLines(statusText = '') {
  const lines = statusText.split(/\r?\n/).filter((line) => line.trim());
  return {
    userFileStatus: lines.filter((line) => !isSystemMetadataStatusLine(line)),
    systemMetadataStatus: lines.filter(isSystemMetadataStatusLine),
  };
}

function diffContainsExpectedFix(diffText = '') {
  return diffText.includes('return a - b') && diffText.includes('return a + b');
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function textFromLog(log, key) {
  const value = log?.[key];
  return typeof value === 'string' ? value : '';
}

function exitCodeFromLog(log) {
  return typeof log?.exitCode === 'number' ? log.exitCode : null;
}

function cwdFromLogs(...logs) {
  for (const log of logs) {
    if (typeof log?.cwd === 'string' && log.cwd.trim()) return log.cwd;
  }
  return null;
}

function normalizeForArtifactSearch(value) {
  return String(value ?? '').replace(/\\+/g, '/');
}

function readJsonLineRole(line) {
  try {
    const parsed = JSON.parse(line);
    return parsed?.message?.role ?? parsed?.role ?? null;
  } catch {
    return null;
  }
}

function isSessionTranscriptArtifactPath(filePath) {
  const normalized = normalizeForArtifactSearch(filePath);
  if (normalized.includes('.trajectory.')) return false;
  return /\.jsonl$/.test(normalized) || /\.jsonl\.reset\./.test(normalized);
}

function countRelevantTranscriptLines(text, needle) {
  const normalizedNeedle = normalizeForArtifactSearch(needle);
  if (!normalizedNeedle) return 0;

  let relevantLineCount = 0;
  let inRelevantTurn = false;
  for (const line of String(text ?? '').split(/\r?\n/).filter(Boolean)) {
    const role = readJsonLineRole(line);
    const containsNeedle = normalizeForArtifactSearch(line).includes(normalizedNeedle);
    if (role === 'user') {
      inRelevantTurn = containsNeedle;
    }
    if (containsNeedle || inRelevantTurn) {
      relevantLineCount += 1;
    }
  }
  return relevantLineCount;
}

async function loadTranscriptArtifact(filePath) {
  try {
    return {
      filePath,
      text: await readFile(filePath, 'utf8'),
    };
  } catch {
    return null;
  }
}

async function recoverRoundsFromSidecarLogs(result, artifactPath) {
  if (Array.isArray(result.rounds) && result.rounds.length > 0) return result;

  const runDir = dirname(resolve(process.cwd(), artifactPath));
  const logsDir = join(runDir, 'logs');
  let entries = [];
  try {
    entries = await readdir(logsDir);
  } catch (error) {
    if (error?.code === 'ENOENT') return result;
    throw error;
  }

  const roundNumbers = Array.from(new Set(entries.flatMap((entry) => {
    const match = /^round-(\d+)-(?:repair-git-diff|repair-git-status|oracle)\.json$/.exec(entry);
    return match ? [Number(match[1])] : [];
  }))).sort((left, right) => left - right);

  const recoveredRounds = [];
  for (const round of roundNumbers) {
    const diffLog = await readJsonIfExists(join(logsDir, `round-${round}-repair-git-diff.json`));
    const statusLog = await readJsonIfExists(join(logsDir, `round-${round}-repair-git-status.json`));
    const oracleLog = await readJsonIfExists(join(logsDir, `round-${round}-oracle.json`));
    const historyTimeoutLog = await readJsonIfExists(join(logsDir, `round-${round}-repair-history-timeout.json`));
    if (!diffLog && !statusLog && !oracleLog) continue;

    const workspace = cwdFromLogs(diffLog, statusLog, oracleLog) ?? join(runDir, 'workspaces', `round-${round}`);
    const gitDiff = textFromLog(diffLog, 'stdout');
    recoveredRounds.push({
      round,
      workspace,
      workspaceId: `round-${round}`,
      repair: {
        changedMath: diffContainsExpectedFix(gitDiff),
        gitStatus: textFromLog(statusLog, 'stdout'),
        gitDiff,
        oracle: {
          exitCode: exitCodeFromLog(oracleLog),
          stdout: textFromLog(oracleLog, 'stdout'),
          stderr: textFromLog(oracleLog, 'stderr'),
          error: oracleLog?.error ?? null,
        },
        traceItems: 0,
        traceError: 'not recorded in sidecar logs',
        transcriptMessages: 0,
        transcriptError: historyTimeoutLog?.error
          || textFromLog(historyTimeoutLog, 'stderr')
          || textFromLog(historyTimeoutLog, 'stdout')
          || 'not recorded in sidecar logs',
        executionGraphCount: 0,
      },
    });
  }

  if (recoveredRounds.length === 0) return result;

  return {
    ...result,
    rounds: recoveredRounds,
    evidenceIntegrity: {
      status: 'recovered-sidecar-logs',
      reason: 'Top-level rounds were empty; recovered repair evidence from logs/round-*-repair-* sidecar files.',
      recoveredRounds: recoveredRounds.length,
    },
  };
}

async function recoverHistoryFromSessionArtifacts(result, artifactPath) {
  if (!Array.isArray(result.rounds) || result.rounds.length === 0) return result;

  const runDir = dirname(resolve(process.cwd(), artifactPath));
  const evidence = await readJsonIfExists(join(runDir, 'model-consistency-evidence.json'));
  const artifactPaths = Array.isArray(evidence?.recentSessionArtifacts)
    ? evidence.recentSessionArtifacts
        .map((artifact) => artifact?.filePath)
        .filter((filePath) => typeof filePath === 'string' && isSessionTranscriptArtifactPath(filePath))
    : [];
  if (artifactPaths.length === 0) return result;

  const artifacts = (await Promise.all(artifactPaths.map(loadTranscriptArtifact))).filter(Boolean);
  if (artifacts.length === 0) return result;

  let recoveredRounds = 0;
  const rounds = result.rounds.map((round) => {
    const repair = round?.repair ?? {};
    const transcriptMessages = Number(repair.transcriptMessages ?? 0);
    if (transcriptMessages > 0 && !repair.transcriptError) return round;
    if (typeof round?.workspace !== 'string' || !round.workspace.trim()) return round;

    let bestEvidence = null;
    for (const artifact of artifacts) {
      const relevantLineCount = countRelevantTranscriptLines(artifact.text, round.workspace);
      if (relevantLineCount > (bestEvidence?.relevantLineCount ?? 0)) {
        bestEvidence = {
          source: 'session-transcript-artifact',
          artifactPath: artifact.filePath,
          relevantLineCount,
          originalError: repair.transcriptError ?? null,
        };
      }
    }
    if (!bestEvidence || bestEvidence.relevantLineCount <= 0) return round;

    recoveredRounds += 1;
    return {
      ...round,
      repair: {
        ...repair,
        transcriptMessages: Math.max(transcriptMessages, bestEvidence.relevantLineCount),
        transcriptError: null,
        transcriptEvidence: bestEvidence,
      },
    };
  });

  if (recoveredRounds === 0) return result;

  return {
    ...result,
    rounds,
    evidenceIntegrity: {
      ...(result.evidenceIntegrity ?? {}),
      historyRecovery: {
        status: 'recovered-session-transcript-artifacts',
        recoveredRounds,
      },
    },
  };
}

function summarizeRound(round) {
  const repair = round?.repair ?? {};
  const { userFileStatus, systemMetadataStatus } = splitWorkspaceStatusLines(repair.gitStatus ?? '');
  const containsExpectedFix = diffContainsExpectedFix(repair.gitDiff ?? '');
  const oraclePassed = repair.oracle?.exitCode === 0;
  const changedExpectedFile = Boolean(repair.changedMath && containsExpectedFix);
  const corePassed = changedExpectedFile && oraclePassed;
  const traceItems = Number(repair.traceItems ?? 0);
  const transcriptMessages = Number(repair.transcriptMessages ?? 0);
  const executionGraphCount = Number(repair.executionGraphCount ?? 0);

  return {
    round: round.round,
    workspace: round.workspace ?? null,
    workspaceId: round.workspaceId ?? null,
    coreExecution: {
      status: corePassed ? 'pass' : 'fail',
      changedExpectedFile,
      oraclePassed,
    },
    diff: {
      status: repair.gitStatus ?? '',
      changedUserFiles: userFileStatus,
      systemMetadataStatus,
      containsExpectedFix,
      raw: repair.gitDiff ?? '',
    },
    oracle: {
      status: oraclePassed ? 'pass' : 'fail',
      exitCode: repair.oracle?.exitCode ?? null,
      stdout: repair.oracle?.stdout ?? '',
      stderr: repair.oracle?.stderr ?? '',
      error: repair.oracle?.error ?? null,
    },
    trace: {
      status: traceItems > 0 && !repair.traceError ? 'pass' : 'fail',
      items: traceItems,
      error: repair.traceError ?? null,
    },
    history: {
      status: transcriptMessages > 0 && !repair.transcriptError ? 'pass' : 'fail',
      messages: transcriptMessages,
      error: repair.transcriptError ?? null,
      evidence: repair.transcriptEvidence ?? null,
    },
    graph: {
      status: executionGraphCount > 0 ? 'pass' : 'fail',
      visibleCount: executionGraphCount,
    },
  };
}

function sanitizeProvider(provider = {}) {
  return {
    configured: Boolean(provider.configured),
    defaultAccountId: provider.defaultAccountId ?? null,
    selectedAccount: provider.selectedAccount
      ? {
          id: provider.selectedAccount.id ?? null,
          vendorId: provider.selectedAccount.vendorId ?? null,
          authMode: provider.selectedAccount.authMode ?? null,
          enabled: provider.selectedAccount.enabled ?? null,
          isDefault: provider.selectedAccount.isDefault ?? null,
          model: provider.selectedAccount.model ?? null,
          hasKey: provider.selectedAccount.hasKey ?? null,
        }
      : null,
    agentModelRefs: Array.isArray(provider.agentModelRefs)
      ? provider.agentModelRefs.map((agent) => ({
          id: agent.id ?? null,
          modelRef: agent.modelRef ?? null,
        }))
      : [],
  };
}

export function buildRuntimeValidationReport(result, options = {}) {
  const rounds = Array.isArray(result.rounds) ? result.rounds.map(summarizeRound) : [];
  const totalRounds = rounds.length;
  const corePassCount = rounds.filter((round) => round.coreExecution.status === 'pass').length;
  const tracePassCount = rounds.filter((round) => round.trace.status === 'pass').length;
  const historyPassCount = rounds.filter((round) => round.history.status === 'pass').length;
  const graphPassCount = rounds.filter((round) => round.graph.status === 'pass').length;
  const totalTraceItems = rounds.reduce((sum, round) => sum + round.trace.items, 0);

  return {
    schemaVersion: 1,
    source: 'scripts/real-runtime-validation.mjs',
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: result.generatedAt ?? null,
    runId: result.runId ?? options.runId ?? createRunId(),
    artifactPath: options.artifactPath ?? null,
    repoRoot: result.repoRoot ?? null,
    electronEntry: result.electronEntry ?? null,
    gateway: {
      ready: result.app?.gateway?.gatewayReady === true,
      state: result.app?.gateway?.state ?? null,
      port: result.app?.gateway?.port ?? null,
    },
    provider: sanitizeProvider(result.app?.provider),
    ...(result.evidenceIntegrity ? { evidenceIntegrity: result.evidenceIntegrity } : {}),
    verdict: {
      coreExecution: {
        status: statusFromCounts(corePassCount, totalRounds),
        passedRounds: corePassCount,
        totalRounds,
      },
      trace: {
        status: statusFromCounts(tracePassCount, totalRounds),
        totalTraceItems,
        passedRounds: tracePassCount,
        totalRounds,
      },
      history: {
        status: statusFromCounts(historyPassCount, totalRounds),
        readableRounds: historyPassCount,
        totalRounds,
      },
      graph: {
        status: statusFromCounts(graphPassCount, totalRounds),
        visibleRounds: graphPassCount,
        totalRounds,
      },
    },
    workspaces: rounds.map((round) => ({
      round: round.round,
      workspace: round.workspace,
      workspaceId: round.workspaceId,
    })),
    rounds,
    failures: Array.isArray(result.failures) ? result.failures : [],
    knownObservationFailures: rounds.flatMap((round) => [
      ...(round.trace.status === 'pass' ? [] : [{ round: round.round, code: 'TRACE_MISSING', detail: round.trace.error ?? 'traceItems=0' }]),
      ...(round.history.status === 'pass' ? [] : [{ round: round.round, code: 'HISTORY_UNAVAILABLE', detail: round.history.error ?? 'transcriptMessages=0' }]),
      ...(round.graph.status === 'pass' ? [] : [{ round: round.round, code: 'EXECUTION_GRAPH_MISSING', detail: 'executionGraphCount=0' }]),
      ...(round.diff.systemMetadataStatus.length === 0
        ? []
        : [{ round: round.round, code: 'PLAN_SYSTEM_METADATA_DIFF', detail: round.diff.systemMetadataStatus.join('\n') }]),
    ]),
  };
}

export async function readRuntimeValidationResult(path) {
  const result = JSON.parse(await readFile(path, 'utf8'));
  const recovered = await recoverRoundsFromSidecarLogs(result, path);
  return recoverHistoryFromSessionArtifacts(recovered, path);
}

export async function writeRuntimeValidationReport(report, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function nextArg(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const from = nextArg(args, '--from');
  if (!from) {
    console.error('Usage: node scripts/real-runtime-validation.mjs --from <real-runtime-validation-result.json> [--output <path>]');
    process.exitCode = 2;
    return;
  }

  const inputPath = resolve(process.cwd(), from);
  const outputPath = resolve(
    process.cwd(),
    nextArg(args, '--output') ?? resolve(dirname(inputPath), DEFAULT_OUTPUT_NAME),
  );
  const result = await readRuntimeValidationResult(inputPath);
  const report = buildRuntimeValidationReport(result, { artifactPath: inputPath });
  await writeRuntimeValidationReport(report, outputPath);
  console.log(`Wrote standardized real-runtime validation report to ${outputPath}`);
  console.log(JSON.stringify(report.verdict, null, 2));
}

if (isMainEntrypoint(import.meta.url)) {
  await main();
}
