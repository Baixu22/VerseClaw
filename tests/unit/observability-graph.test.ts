import { describe, expect, it } from 'vitest';
import { buildObservabilityTraceGraph } from '../../electron/services/observability-graph';
import type { ObservabilityTrace } from '../../shared/types/observability';

const tokenUsage = {
  input: 120,
  output: 80,
  cacheRead: 10,
  cacheWrite: 0,
  totalTokens: 210,
  costUsd: 0.004,
};

describe('observability trace graph mapper', () => {
  it('maps spans and trajectory events into an agent trace graph', () => {
    const startedAt = Date.parse('2026-06-16T10:00:00.000Z');
    const trace: ObservabilityTrace = {
      id: 'trace_run_1',
      name: 'Implement trace graph',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      task: 'Build agent trace visualization',
      status: 'error',
      startedAt,
      durationMs: 3200,
      tokenUsage,
      metrics: {},
      tags: ['role-first'],
      events: [{
        id: 'event-1',
        traceId: 'trace_run_1',
        spanId: 'tool-1',
        type: 'tool.output',
        name: 'Tool output received',
        timestamp: startedAt + 300,
        attributes: { bytes: 128 },
      }],
      spans: [
        {
          id: 'router-1',
          traceId: 'trace_run_1',
          name: 'role-router',
          kind: 'role-router',
          roleName: 'implementer',
          status: 'completed',
          startedAt,
          durationMs: 20,
        },
        {
          id: 'model-1',
          traceId: 'trace_run_1',
          parentSpanId: 'router-1',
          name: 'model.call',
          kind: 'model',
          modelRef: 'openai:gpt-5',
          status: 'completed',
          startedAt: startedAt + 100,
          durationMs: 700,
          input: 'summarized prompt',
          output: 'model summary',
          tokenUsage,
        },
        {
          id: 'tool-1',
          traceId: 'trace_run_1',
          parentSpanId: 'router-1',
          name: 'shell_command',
          kind: 'tool',
          status: 'error',
          startedAt: startedAt + 200,
          durationMs: 90,
          error: 'Command failed',
        },
      ],
    };

    const longOutput = 'x'.repeat(400);
    const result = buildObservabilityTraceGraph(trace, [
      {
        type: 'patch.completed',
        ts: '2026-06-16T10:00:01.000Z',
        seq: 2,
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        data: { name: 'src/App.tsx', output: longOutput },
      },
      {
        type: 'tool.retry',
        ts: '2026-06-16T10:00:01.500Z',
        seq: 4,
        spanId: 'tool-1',
        runId: 'run-1',
        data: { toolName: 'shell_command', reason: 'retry after failure' },
      },
      {
        type: 'tool.failed',
        ts: '2026-06-16T10:00:02.000Z',
        seq: 3,
        runId: 'run-1',
        data: { toolName: 'shell_command', error: 'permission denied' },
      },
      {
        type: 'tool.failed',
        ts: '2026-06-16T10:00:02.000Z',
        seq: 3,
        runId: 'run-1',
        data: { toolName: 'shell_command', error: 'permission denied' },
      },
    ]);

    expect(result.trace.id).toBe('trace_run_1');
    expect(result.graph.nodes.find((node) => node.kind === 'root')?.label).toBe('Implement trace graph');
    expect(result.graph.nodes.find((node) => node.kind === 'root')?.phase).toBe('input');
    expect(result.graph.nodes.some((node) => node.kind === 'router' && node.roleName === 'implementer' && node.phase === 'routing')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'model' && node.modelRef === 'openai:gpt-5' && node.phase === 'model')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'tool' && node.status === 'error')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'file' && node.phase === 'artifact' && node.label === 'src/App.tsx')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'error' && node.error === 'permission denied')).toBe(true);
    expect(result.graph.nodes.filter((node) => node.kind === 'error' && node.error === 'permission denied')).toHaveLength(1);
    expect(result.graph.edges.some((edge) => edge.status === 'error' && edge.critical)).toBe(true);
    expect(result.graph.edges.some((edge) => edge.kind === 'artifact')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.kind === 'retry')).toBe(true);
    expect(result.graph.summary?.errorNodeIds.length).toBeGreaterThan(0);
    expect(result.graph.summary?.criticalPathNodeIds).toContain('trace:trace_run_1');
    expect(result.graph.summary?.artifactNodeIds.some((id) => id.includes('patch.completed'))).toBe(true);
    expect(result.graph.summary?.tokenHotspotNodeIds).toContain('span:model-1');
    expect(result.graph.summary?.slowNodeIds.length).toBeGreaterThan(0);
    expect(result.timeline.map((item) => item.timestamp)).toEqual([...result.timeline.map((item) => item.timestamp)].sort((a, b) => a - b));

    const fileNode = result.graph.nodes.find((node) => node.kind === 'file');
    expect(fileNode?.outputPreview).toMatch(/^redacted-preview:\d+(?::[a-f0-9]+)?$/u);
    expect(fileNode?.outputPreview).not.toContain(longOutput);

    const retryNode = result.graph.nodes.find((node) => node.subtitle === 'tool.retry');
    expect(retryNode?.retryCount).toBe(1);
    expect(result.graph.summary?.issues?.some((issue) => issue.category === 'error-root-cause')).toBe(true);
    expect(result.graph.summary?.coverage).toMatchObject({
      hasRuntimeSpans: true,
      hasTrajectory: true,
      redacted: true,
    });
    expect(result.graph.summary?.sourceStatus).toBe('live');
  });

  it('maps diagnostic phases for approval, aborted, warning, and unknown trajectory events', () => {
    const startedAt = Date.parse('2026-06-16T11:00:00.000Z');
    const trace: ObservabilityTrace = {
      id: 'trace_diagnostic_edges',
      name: 'Diagnose long agent run',
      runId: 'run-diagnostic',
      sessionKey: 'agent:main:diagnostic',
      task: 'Exercise diagnostic phases',
      status: 'running',
      startedAt,
      durationMs: 5000,
      tokenUsage,
      metrics: {},
      tags: ['chat-run'],
      events: [],
      spans: [
        {
          id: 'orchestrator-1',
          traceId: 'trace_diagnostic_edges',
          name: 'orchestrator',
          kind: 'orchestrator',
          status: 'running',
          startedAt,
          durationMs: 5000,
        },
        {
          id: 'tool-1',
          traceId: 'trace_diagnostic_edges',
          parentSpanId: 'orchestrator-1',
          name: 'apply_patch',
          kind: 'tool',
          status: 'running',
          startedAt: startedAt + 500,
          durationMs: 3000,
        },
      ],
    };

    const result = buildObservabilityTraceGraph(trace, [
      {
        type: 'approval.requested',
        ts: '2026-06-16T11:00:01.000Z',
        seq: 1,
        runId: 'run-diagnostic',
        data: { name: 'Approve patch', reason: 'workspace write' },
      },
      {
        type: 'command.aborted',
        ts: '2026-06-16T11:00:02.000Z',
        seq: 2,
        runId: 'run-diagnostic',
        data: { toolName: 'powershell', error: 'user cancelled' },
      },
      {
        type: 'runtime.warning',
        ts: '2026-06-16T11:00:03.000Z',
        seq: 3,
        runId: 'run-diagnostic',
        data: { warning: 'retry budget almost exhausted' },
      },
      {
        type: 'custom.signal',
        ts: '2026-06-16T11:00:04.000Z',
        seq: 4,
        runId: 'run-diagnostic',
        data: { summary: 'unclassified runtime signal' },
      },
    ]);

    const approval = result.graph.nodes.find((node) => node.subtitle === 'approval.requested');
    expect(approval).toMatchObject({
      kind: 'approval',
      phase: 'approval',
      status: 'running',
      label: 'Approve patch',
    });

    const aborted = result.graph.nodes.find((node) => node.subtitle === 'command.aborted');
    expect(aborted).toMatchObject({
      kind: 'tool',
      phase: 'tool',
      status: 'aborted',
      error: 'user cancelled',
    });

    const warning = result.graph.nodes.find((node) => node.subtitle === 'runtime.warning');
    expect(warning).toMatchObject({
      kind: 'error',
      phase: 'warning',
      status: 'error',
      warningCount: 1,
      error: 'retry budget almost exhausted',
    });

    const unknown = result.graph.nodes.find((node) => node.subtitle === 'custom.signal');
    expect(unknown).toMatchObject({
      kind: 'event',
      phase: 'event',
      status: 'running',
      summary: 'unclassified runtime signal',
    });

    expect(result.graph.summary?.errorNodeIds).toEqual(expect.arrayContaining([
      aborted?.id,
      warning?.id,
    ]));
    expect(result.graph.summary?.criticalPathNodeIds).toContain('trace:trace_diagnostic_edges');
    expect(result.timeline.map((item) => item.type)).toEqual(expect.arrayContaining([
      'approval.requested',
      'command.aborted',
      'runtime.warning',
      'custom.signal',
    ]));
  });
});
