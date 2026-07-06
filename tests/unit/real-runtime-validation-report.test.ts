import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRuntimeValidationReport,
  createRunId,
  readRuntimeValidationResult,
  splitWorkspaceStatusLines,
} from '../../scripts/real-runtime-validation.mjs';

describe('real runtime validation report', () => {
  it('creates stable run IDs from timestamps', () => {
    expect(createRunId(new Date('2026-07-04T13:33:26.000Z'))).toBe('run-20260704-133326');
  });

  it('separates user file changes from system metadata status lines', () => {
    expect(splitWorkspaceStatusLines(' M src/math.js\n?? .verse-claw/\n?? notes.txt\n')).toEqual({
      userFileStatus: [' M src/math.js', '?? notes.txt'],
      systemMetadataStatus: ['?? .verse-claw/'],
    });
  });

  it('summarizes core execution separately from trace and history observation failures', () => {
    const report = buildRuntimeValidationReport({
      runId: 'run-20260704-133326',
      generatedAt: '2026-07-04T09:33:46.176Z',
      app: {
        started: true,
        gateway: { gatewayReady: true },
        provider: {
          configured: true,
          selectedAccount: {
            id: 'deepseek',
            vendorId: 'deepseek',
            model: 'deepseek/deepseek-v4-flash',
            hasKey: true,
          },
          agentModelRefs: [{ id: 'main', modelRef: 'deepseek/deepseek-v4-flash' }],
        },
      },
      rounds: [
        {
          round: 1,
          workspace: 'C:/tmp/round-1',
          workspaceId: 'workspace-1',
          repair: {
            changedMath: true,
            gitStatus: ' M src/math.js\n?? .verse-claw/\n',
            gitDiff: 'diff --git a/src/math.js b/src/math.js\n-  return a + b;\n+  return a - b;\n',
            oracle: { exitCode: 0, stdout: 'math tests passed\n', stderr: '', error: null },
            traceItems: 0,
            traceError: null,
            transcriptMessages: 0,
            transcriptError: 'chat.history unavailable during gateway startup',
            executionGraphCount: 1,
          },
        },
        {
          round: 2,
          workspace: 'C:/tmp/round-2',
          workspaceId: 'workspace-2',
          repair: {
            changedMath: true,
            gitStatus: ' M src/math.js\n?? .verse-claw/\n',
            gitDiff: 'diff --git a/src/math.js b/src/math.js\n-  return a + b;\n+  return a - b;\n',
            oracle: { exitCode: 0, stdout: 'math tests passed\n', stderr: '', error: null },
            traceItems: 0,
            traceError: null,
            transcriptMessages: 60,
            transcriptError: null,
            executionGraphCount: 3,
          },
        },
      ],
      failures: [{ code: 'TRACE_MISSING', detail: 'no traces' }],
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      runId: 'run-20260704-133326',
      provider: {
        selectedAccount: {
          id: 'deepseek',
          model: 'deepseek/deepseek-v4-flash',
          hasKey: true,
        },
      },
      verdict: {
        coreExecution: { status: 'pass', passedRounds: 2, totalRounds: 2 },
        trace: { status: 'fail', totalTraceItems: 0 },
        history: { status: 'partial', readableRounds: 1, totalRounds: 2 },
        graph: { status: 'pass', visibleRounds: 2, totalRounds: 2 },
      },
    });
    expect(report.rounds[0]).toMatchObject({
      workspace: 'C:/tmp/round-1',
      diff: {
        changedUserFiles: [' M src/math.js'],
        systemMetadataStatus: ['?? .verse-claw/'],
        containsExpectedFix: true,
      },
      oracle: {
        status: 'pass',
        stdout: 'math tests passed\n',
      },
      trace: {
        status: 'fail',
        items: 0,
      },
      history: {
        status: 'fail',
        messages: 0,
      },
    });
  });

  it('recovers core repair evidence from sidecar logs when a later run overwrote top-level rounds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'real-runtime-validation-report-'));
    const logsDir = join(root, 'logs');
    const workspace = join(root, 'workspaces', 'round-1');
    await mkdir(logsDir, { recursive: true });
    await mkdir(workspace, { recursive: true });

    const resultPath = join(root, 'real-runtime-validation-result.json');
    await writeFile(resultPath, JSON.stringify({
      runId: 'run-sidecar',
      generatedAt: '2026-07-04T13:48:17.249Z',
      app: {
        gateway: {
          error: 'Gateway process exited before becoming ready',
        },
      },
      rounds: [],
      failures: [{ code: 'GATEWAY_NOT_READY', detail: 'Gateway process exited before becoming ready' }],
    }, null, 2), 'utf8');
    await writeFile(join(logsDir, 'round-1-repair-git-diff.json'), JSON.stringify({
      cwd: workspace,
      exitCode: 0,
      stdout: [
        'diff --git a/src/math.js b/src/math.js',
        '-  return a + b;',
        '+  return a - b;',
        '',
      ].join('\n'),
      stderr: '',
    }, null, 2), 'utf8');
    await writeFile(join(logsDir, 'round-1-repair-git-status.json'), JSON.stringify({
      cwd: workspace,
      exitCode: 0,
      stdout: ' M src/math.js\n?? .verse-claw/\n',
      stderr: '',
    }, null, 2), 'utf8');
    await writeFile(join(logsDir, 'round-1-oracle.json'), JSON.stringify({
      cwd: workspace,
      exitCode: 0,
      stdout: 'math tests passed\n',
      stderr: '',
    }, null, 2), 'utf8');

    const result = await readRuntimeValidationResult(resultPath);
    const report = buildRuntimeValidationReport(result, { artifactPath: resultPath });

    expect(report.evidenceIntegrity).toMatchObject({
      status: 'recovered-sidecar-logs',
      recoveredRounds: 1,
    });
    expect(report.verdict.coreExecution).toMatchObject({
      status: 'pass',
      passedRounds: 1,
      totalRounds: 1,
    });
    expect(report.verdict.trace.status).toBe('fail');
    expect(report.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'GATEWAY_NOT_READY' }),
    ]));
    expect(report.knownObservationFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({ round: 1, code: 'TRACE_MISSING' }),
      expect.objectContaining({
        round: 1,
        code: 'HISTORY_UNAVAILABLE',
        detail: 'not recorded in sidecar logs',
      }),
      expect.objectContaining({ round: 1, code: 'EXECUTION_GRAPH_MISSING' }),
      expect.objectContaining({ round: 1, code: 'PLAN_SYSTEM_METADATA_DIFF' }),
    ]));
  });

  it('recovers history readability from current-run session transcript artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'real-runtime-validation-history-'));
    const workspace = join(root, 'workspaces', 'round-1');
    const transcriptPath = join(root, 'sessions', 'session.jsonl.reset.2026-07-04T20-01-42.610Z');
    await mkdir(workspace, { recursive: true });
    await mkdir(join(root, 'sessions'), { recursive: true });

    const resultPath = join(root, 'real-runtime-validation-result.json');
    await writeFile(resultPath, JSON.stringify({
      runId: 'run-history-recovery',
      generatedAt: '2026-07-04T20:01:42.000Z',
      app: {
        gateway: { gatewayReady: true },
      },
      rounds: [
        {
          round: 1,
          workspace,
          workspaceId: 'workspace-1',
          repair: {
            changedMath: true,
            gitStatus: ' M src/math.js\n',
            gitDiff: 'diff --git a/src/math.js b/src/math.js\n-  return a + b;\n+  return a - b;\n',
            oracle: { exitCode: 0, stdout: 'math tests passed\n', stderr: '', error: null },
            traceItems: 1,
            traceError: null,
            transcriptMessages: 0,
            transcriptError: 'chat.history unavailable during gateway startup',
            executionGraphCount: 1,
          },
        },
      ],
    }, null, 2), 'utf8');
    await writeFile(join(root, 'model-consistency-evidence.json'), JSON.stringify({
      recentSessionArtifacts: [
        {
          filePath: transcriptPath,
          containsRunWorkspace: true,
          relevantLineCount: 3,
        },
      ],
    }, null, 2), 'utf8');
    await writeFile(transcriptPath, [
      JSON.stringify({ type: 'message', message: { role: 'user', content: `Validation repair task. Workspace root: ${workspace}` } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: 'I will edit src/math.js' } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: 'Changed src/math.js and math tests passed' } }),
      '',
    ].join('\n'), 'utf8');

    const result = await readRuntimeValidationResult(resultPath);
    const report = buildRuntimeValidationReport(result, { artifactPath: resultPath });

    expect(report.verdict.history).toMatchObject({
      status: 'pass',
      readableRounds: 1,
      totalRounds: 1,
    });
    expect(report.rounds[0].history).toMatchObject({
      status: 'pass',
      messages: 3,
      error: null,
      evidence: expect.objectContaining({
        source: 'session-transcript-artifact',
        artifactPath: transcriptPath,
      }),
    });
    expect(report.knownObservationFailures).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HISTORY_UNAVAILABLE' }),
    ]));
  });
});
