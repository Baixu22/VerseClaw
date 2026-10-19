#!/usr/bin/env node
/**
 * NET-G (TF-0444): independent fault-injection acceptance for the network
 * reliability phase (TF-0437..TF-0444).
 *
 * The harness RE-RUNS the fault scenarios against the current candidate instead
 * of re-reading earlier evidence. Every check spawns a real command, captures
 * its exit code and the parsed vitest counts, and only then classifies the
 * check:
 *
 *   pass       - command exited 0 and reported at least `minTests` passing tests
 *   fail       - anything else (a failure keeps TF-0437/TF-0444 open)
 *   unverified - the check cannot be proven in this environment (for example a
 *                live paid-provider 429, or the gateway wire-level deadline that
 *                TF-0442 has not implemented). Unverified never becomes pass.
 *
 * Results are split by plane so a wire-attempt result is never confused with a
 * logical-turn result. No credential and no paid provider request is required;
 * all evidence is driven_by=agent.
 *
 * Usage:
 *   node scripts/network-reliability-fault-injection.mjs [--root <dir>] [--out <dir>] [--check <id>]
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { candidateIdentity } from './comms/replay.mjs';

export const REPORT_SCHEMA = 'clawx.network-protocol-reliability.net-g.report.v1';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');
const CHECK_TIMEOUT_MS = 15 * 60_000;

/** Fault-injection checks, grouped by the plane that observes the outcome. */
export const CHECKS = [
  {
    id: 'wire-retry-budget',
    plane: 'wire_attempt',
    faults: ['retry budget', 'Retry-After lower bound', 'physical attempt accounting'],
    claim: 'agent auto-retry, model fallback, retryAsync and the provider transport share one logical attempt budget',
    cwd: '.',
    command: ['pnpm', '--dir', 'openclaw_runtime', 'exec', 'vitest', 'run', 'src/agents/request-attempt-budget.test.ts', 'src/agents/retry-after.test.ts', 'src/infra/retry.test.ts', '--maxWorkers=1'],
    minTests: 15,
  },
  {
    id: 'wire-provider-429-503-breaker',
    plane: 'wire_attempt',
    faults: ['provider 429', 'provider 503', 'breaker open fast-fail', 'half-open single probe', 'budget refusal non-double-count'],
    claim: 'the endpoint breaker counts only transport/429/5xx, opens after the threshold, admits one half-open probe and never double counts a budget refusal',
    cwd: '.',
    command: ['pnpm', '--dir', 'openclaw_runtime', 'exec', 'vitest', 'run', 'src/agents/provider-endpoint-health.test.ts', 'src/agents/provider-outbound-budget.test.ts', '--maxWorkers=1'],
    minTests: 30,
  },
  {
    id: 'turn-gateway-seq-gap-reconnect',
    plane: 'logical_turn',
    faults: ['gateway disconnect', 'sequence gap', 'reconnect resubscribe'],
    claim: 'an unsupported negotiated protocol is rejected, a seq gap raises a typed event and a reconnect re-establishes observability subscriptions',
    cwd: '.',
    command: ['pnpm', 'exec', 'vitest', 'run', 'tests/unit/gateway-ws-client.test.ts', 'tests/unit/gateway-events.test.ts', 'tests/unit/observability-trajectory-projection.test.ts', '--maxWorkers=1'],
    minTests: 30,
  },
  {
    id: 'turn-mid-stream-failure',
    plane: 'logical_turn',
    faults: ['mid-stream provider failure', 'partial output', 'client disconnect'],
    claim: 'a post-header failure stays incomplete on the wire, never fabricates a stop/usage, never emits response.completed after response.failed and stays silent after a client disconnect',
    cwd: '.',
    command: ['pnpm', 'exec', 'vitest', 'run', 'tests/unit/provider-error-http-boundaries.test.ts', '--maxWorkers=1'],
    minTests: 20,
  },
  {
    id: 'turn-stream-failure-isolation',
    plane: 'logical_turn',
    faults: ['failed-attempt tool isolation', 'typed stream error'],
    claim: 'a failed attempt is discarded, its tool calls cannot reach the transcript and a retry is allowed only for the same logical step without effects',
    cwd: '.',
    command: ['pnpm', '--dir', 'openclaw_runtime', 'exec', 'vitest', 'run', 'src/agents/stream-failure.test.ts', '--maxWorkers=1'],
    minTests: 13,
  },
  {
    id: 'turn-gateway-provider-deadline',
    plane: 'logical_turn',
    faults: ['gateway deadline gate', 'provider request-timeout clamp', 'spent deadline fail-closed'],
    claim: 'the gateway rejects a spent deadline before starting the turn, a live deadline is clamped to what remains and the provider request timeout never starts a fresh window',
    cwd: '.',
    command: ['pnpm', '--dir', 'openclaw_runtime', 'exec', 'vitest', 'run', 'src/agents/request-deadline.test.ts', 'src/agents/provider-endpoint-health.test.ts', 'packages/gateway-protocol/src/schema/logs-chat.test.ts', '--maxWorkers=1'],
    minTests: 40,
  },
  {
    id: 'repo-typecheck',
    plane: 'repo_gate',
    faults: ['type surface drift'],
    claim: 'the candidate still typechecks across node/web/test projects',
    cwd: '.',
    command: ['pnpm', 'run', 'typecheck'],
    minTests: 0,
  },
  {
    id: 'turn-deadline-cancel',
    plane: 'logical_turn',
    faults: ['host deadline clamp', 'expired deadline fail-fast', 'long-action clamp', 'renderer timeout details'],
    claim: 'one logical deadline is clamped per layer (never summed), an expired deadline fails closed before the action runs and timeout details carry stage/deadlineMs/elapsedMs/requestId',
    cwd: '.',
    command: ['pnpm', 'exec', 'vitest', 'run', 'tests/unit/host-deadline.test.ts', 'tests/unit/host-api-client-error-metadata.test.ts', 'tests/unit/r0-4-host-api-client-timeout.test.ts', 'tests/unit/r0-4-host-invoke-timeout.test.ts', 'tests/unit/chat-api-workspace-fingerprint.test.ts', '--maxWorkers=1'],
    minTests: 28,
  },
];

/** Faults the harness deliberately does not claim as verified. */
export const UNVERIFIED = [
  {
    id: 'live-provider-429-503',
    reason: 'no real credential or paid provider request is allowed; 429/503 are injected synthetically',
  },
  {
    id: 'non-chat-gateway-deadline',
    reason: 'TF-0442 propagates the deadline through the chat turn path (chat.sendWithMedia -> chat.send -> provider); other gateway RPC methods and a packaged Electron run are not covered',
  },
  {
    id: 'electron-e2e-disconnect',
    reason: 'disconnect is injected through the loopback HTTP harness, not a packaged Electron run',
  },
  {
    id: 'network-pooling-p50',
    reason: 'pooling and P50 latency are owned by TF-0413/TF-0414, not this phase',
  },
];

function gitExecutable() {
  return process.platform === 'win32' ? 'git.exe' : 'git';
}

function resolveTempDir() {
  const existing = process.env.TEMP || process.env.TMP;
  if (existing && existing.toLowerCase().startsWith('d:')) {
    return existing;
  }
  return process.platform === 'win32' ? 'D:\\tmp' : (existing || '/tmp');
}

function spawnCaptured(command, options) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, CHECK_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, output: output + String(error), durationMs: Date.now() - startedAt, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, output, durationMs: Date.now() - startedAt, timedOut });
    });
  });
}

function parseVitestCounts(output) {
  const tests = /Tests\s+(?:(\d+) failed[^\d]*)?(\d+) passed/u.exec(output);
  const files = /Test Files\s+(?:(\d+) failed[^\d]*)?(\d+) passed/u.exec(output);
  return {
    testsPassed: tests ? Number(tests[2]) : 0,
    testsFailed: tests && tests[1] ? Number(tests[1]) : 0,
    filesPassed: files ? Number(files[2]) : 0,
    filesFailed: files && files[1] ? Number(files[1]) : 0,
  };
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function runFaultInjection(options = {}) {
  const root = path.resolve(options.root ?? DEFAULT_ROOT);
  const outDir = path.resolve(options.outDir ?? path.join(root, 'artifacts/network-protocol-reliability/net-g'));
  const only = options.only ? new Set(options.only) : null;
  const tempDir = resolveTempDir();
  await mkdir(tempDir, { recursive: true });
  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, 'logs'), { recursive: true });

  const candidate = candidateIdentity(root);
  const env = { ...process.env, TEMP: tempDir, TMP: tempDir };
  const checks = [];

  for (const check of CHECKS) {
    if (only && !only.has(check.id)) continue;
    const cwd = path.resolve(root, check.cwd);
    const run = await spawnCaptured(check.command, { cwd, env });
    const counts = parseVitestCounts(run.output);
    const logName = `${check.id}.log`;
    const passed =
      run.exitCode === 0 &&
      !run.timedOut &&
      counts.testsFailed === 0 &&
      counts.filesFailed === 0 &&
      counts.testsPassed >= check.minTests;
    checks.push({
      id: check.id,
      plane: check.plane,
      faults: check.faults,
      claim: check.claim,
      command: check.command.join(' '),
      cwd: path.relative(root, cwd) || '.',
      exit_code: run.exitCode,
      timed_out: run.timedOut,
      duration_ms: run.durationMs,
      tests_passed: counts.testsPassed,
      tests_failed: counts.testsFailed,
      files_passed: counts.filesPassed,
      files_failed: counts.filesFailed,
      min_tests: check.minTests,
      status: passed ? 'pass' : 'fail',
      log: `logs/${logName}`,
      log_sha256: sha256(run.output),
    });
    await writeFile(path.join(outDir, 'logs', logName), run.output, 'utf8');
  }

  const passed = checks.filter((check) => check.status === 'pass').length;
  const failed = checks.filter((check) => check.status === 'fail').length;
  const wireAttempts = checks.filter((check) => check.plane === 'wire_attempt');
  const logicalTurns = checks.filter((check) => check.plane === 'logical_turn');
  const repoGates = checks.filter((check) => check.plane === 'repo_gate');
  const report = {
    schema: REPORT_SCHEMA,
    node: 'TF-0444',
    phase_root: 'TF-0437',
    driven_by: 'agent',
    generated_at: new Date().toISOString(),
    live_provider: false,
    candidate: {
      commit: candidate.commit,
      tree: candidate.tree,
    },
    environment: {
      platform: process.platform,
      node: process.version,
      temp_dir: tempDir,
    },
    summary: {
      checks: checks.length,
      passed,
      failed,
      unverified: UNVERIFIED.length,
      decision: failed === 0 && checks.length === CHECKS.length ? 'acceptance-ok' : 'needs-attention',
    },
    planes: {
      wire_attempt: { passed: wireAttempts.filter((c) => c.status === 'pass').length, failed: wireAttempts.filter((c) => c.status === 'fail').length },
      logical_turn: { passed: logicalTurns.filter((c) => c.status === 'pass').length, failed: logicalTurns.filter((c) => c.status === 'fail').length },
      repo_gate: { passed: repoGates.filter((c) => c.status === 'pass').length, failed: repoGates.filter((c) => c.status === 'fail').length },
    },
    checks,
    unverified: UNVERIFIED,
  };

  const reportJson = JSON.stringify(report, null, 2) + '\n';
  await writeFile(path.join(outDir, 'report.json'), reportJson, 'utf8');
  const reportSha256 = sha256(reportJson);
  await writeFile(path.join(outDir, 'SHA256SUMS'), `${reportSha256}  report.json\n`, 'utf8');

  const lines = [
    '# Network reliability fault injection (NET-G / TF-0444)',
    '',
    `- Candidate: \`${candidate.commit}\` (tree \`${candidate.tree}\`)`,
    `- Generated: ${report.generated_at}`,
    `- Driven by: agent (no live provider request, no credential)`,
    `- Decision: **${report.summary.decision}** — ${passed}/${checks.length} checks passed, ${failed} failed, ${UNVERIFIED.length} unverified`,
    '',
    '## Checks by plane',
    '',
    '| Plane | Check | Faults | Exit | Tests | Status | Log |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const check of checks) {
    lines.push(
      `| ${check.plane} | ${check.id} | ${check.faults.join(', ')} | ${check.exit_code} | ${check.tests_passed} passed / ${check.tests_failed} failed | ${check.status.toUpperCase()} | \`${check.log}\` (\`${check.log_sha256.slice(0, 16)}…\`) |`,
    );
  }
  lines.push('', '## Not verified', '');
  for (const item of UNVERIFIED) {
    lines.push(`- \`${item.id}\`: ${item.reason}`);
  }
  lines.push(
    '',
    '## Re-run',
    '',
    '```bash',
    'node scripts/network-reliability-fault-injection.mjs',
    'node scripts/network-reliability-fault-injection.mjs --check turn-mid-stream-failure',
    '```',
    '',
    `\`report.json\` sha256: \`${reportSha256}\` (see \`SHA256SUMS\`). Unverified checks never count as pass; a failing check keeps TF-0437/TF-0444 open.`,
    '',
  );
  await writeFile(path.join(outDir, 'report.md'), lines.join('\n'), 'utf8');
  return { report, outDir, reportSha256 };
}

function parseArgs(argv) {
  const options = { only: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') options.root = argv[++index];
    else if (arg === '--out') options.outDir = argv[++index];
    else if (arg === '--check') options.only.push(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.only.length === 0) delete options.only;
  return options;
}

if (isMainEntrypoint(import.meta.url)) {
  runFaultInjection(parseArgs(process.argv.slice(2)))
    .then(({ report, outDir, reportSha256 }) => {
      console.log(`[net-g] ${report.summary.decision}: ${report.summary.passed}/${report.summary.checks} checks passed, ${report.summary.failed} failed, ${report.summary.unverified} unverified`);
      console.log(`[net-g] wrote ${path.join(outDir, 'report.json')} (sha256 ${reportSha256})`);
      if (report.summary.failed > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error('[net-g] fault injection failed:', error);
      process.exitCode = 1;
    });
}
