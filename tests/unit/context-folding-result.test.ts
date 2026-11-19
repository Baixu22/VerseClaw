// @vitest-environment node
/**
 * context-folding-rlm / TF-0691 (CF-01): ContextFoldResult/v1 contract and
 * flag-off byte parity.
 *
 * The result contract forces child identity, evidence refs, unresolved claims,
 * blockers, failed attempts and usage; it rejects any transcript-shaped key and
 * bounds the parent projection. The parity suite compares the flag-off tool
 * surface against the baseline captured at a clean HEAD before this track
 * touched any runtime code (tests/unit/fixtures/context-folding/off-mode-baseline.json).
 *
 * driven_by: agent; actor: claude-fable-5.1/context-folding-rlm
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceId } from '../../shared/types/identity-scope';
import {
  CONTEXT_FOLD_FORBIDDEN_RESULT_KEYS,
  CONTEXT_FOLD_RESULT_SCHEMA,
  CONTEXT_FOLDING_ENV,
  CONTEXT_FOLDING_LIMITS,
  ContextFoldingValidationError,
  createContextFoldDeliveryLedger,
  createContextHandle,
  evidenceRefForHandle,
  measureContextFoldOutputChars,
  normalizeContextFoldResult,
  projectContextFoldResultForParent,
  stableStringifyContextFolding,
} from '../../shared/types/context-folding';
import {
  createDcsContextAgentTools,
  serializeContextToolSchemas,
  DCS_ALL_CONTEXT_TOOL_NAMES,
  DCS_CONTEXT_AGENT_TOOL_NAMES,
  DCS_CONTEXT_VIEW_TOOL_NAMES,
} from '../../openclaw_runtime/src/agents/tools/context-agent-tools';
import {
  CONTEXT_TOOL_SUMMARY_BY_NAME,
  CODING_FACT_TOOL_NAMES,
  CODING_TOOL_ROUTING_PROMPT,
  CODING_TOOL_NAVIGATION_LINE,
  CODING_TOOL_ROUTING_HINTS,
  CODING_NAV_PROMPT_MAX_CHARS,
  buildCodingToolNavigationPrompt,
} from '../../openclaw_runtime/src/context-engine/coding-tool-navigation';
import { listCoreToolSections } from '../../openclaw_runtime/src/agents/tool-catalog';
import { createOpenClawTools } from '../../openclaw_runtime/src/agents/openclaw-tools';
import { isContextFoldingEnabled } from '../../openclaw_runtime/src/context-engine/context-folding/flags';

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const WS_A = 'ws-a' as WorkspaceId;
const NOW = '2026-11-03T00:00:00.000Z';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ContextFoldingValidationError) return error.issues[0]!.code;
    throw error;
  }
  throw new Error('expected a ContextFoldingValidationError');
}

const handle = createContextHandle({
  owner: 'workspace-file',
  scope: { workspaceId: WS_A, sessionId: 'sess-parent' },
  resourceId: 'src/taskboard.py',
  content: 'task.revision += 1',
  revision: 'rev-1',
}, { hash, now: NOW });

function completedResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: CONTEXT_FOLD_RESULT_SCHEMA,
    foldId: 'cff_0123456789abcdef0123456789abcdef',
    childSessionKey: 'agent:main:subagent:child-1',
    childRunId: 'run-child-1',
    status: 'completed',
    summary: 'complete_task increments revision unconditionally; guard on status == done.',
    structuredOutput: { defectLocation: 'src/taskboard.py:L30', fix: 'early return when already done' },
    evidenceRefs: [evidenceRefForHandle(handle, 'excerpt'), { ...evidenceRefForHandle(handle, 'test'), label: 'unittest exit 1' }],
    unresolvedClaims: [],
    blockers: [],
    failedAttempts: [],
    inputRefs: [handle.handleId],
    usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500, latencyMs: 2200 },
    diagnostics: [],
    rawChildTranscriptChars: 0,
    recursionDepth: 1,
    deliveryId: 'delivery-1',
    deliveredAt: NOW,
    drivenBy: 'agent',
    actor: 'child-worker',
    ...overrides,
  };
}

describe('ContextFoldResult/v1', () => {
  it('accepts a complete result and measures its output size', () => {
    const result = normalizeContextFoldResult(completedResult());
    expect(result.status).toBe('completed');
    expect(result.childRunId).toBe('run-child-1');
    expect(result.outputChars).toBe(measureContextFoldOutputChars(result.summary, result.structuredOutput));
    expect(result.rawChildTranscriptChars).toBe(0);
    expect(result.recursionDepth).toBe(1);
    expect(result.usage.totalTokens).toBe(1500);
    expect(normalizeContextFoldResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(normalizeContextFoldResult(completedResult({ outputChars: result.outputChars })).outputChars).toBe(result.outputChars);
  });

  it('requires child identity, evidence refs, unresolved claims, blockers, failed attempts, usage and the agent label', () => {
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ childRunId: '' })))).toBe('child_identity_mismatch');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ childSessionKey: undefined })))).toBe('child_identity_mismatch');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ evidenceRefs: [] })))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ evidenceRefs: undefined })))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ unresolvedClaims: undefined })))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ blockers: undefined })))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ failedAttempts: undefined })))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ usage: {} })))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ usage: undefined })))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ drivenBy: 'human' })))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ actor: '' })))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ deliveryId: '' })))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ outputChars: 1 })))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ evidenceRefs: [{ ...evidenceRefForHandle(handle, 'excerpt'), handleId: 'nope' }] })))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ status: 'succeeded' })))).toBe('invalid_result');
  });

  it('rejects any transcript-shaped key at the top level or inside structuredOutput', () => {
    for (const key of CONTEXT_FOLD_FORBIDDEN_RESULT_KEYS) {
      expect(codeOf(() => normalizeContextFoldResult(completedResult({ [key]: 'raw child transcript' }))), key).toBe('raw_transcript_rejected');
      expect(codeOf(() => normalizeContextFoldResult(completedResult({ structuredOutput: { [key]: ['...'] } }))), key).toBe('raw_transcript_rejected');
    }
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ rawChildTranscriptChars: CONTEXT_FOLDING_LIMITS.rawChildTranscriptMaxChars + 1 })))).toBe('raw_transcript_rejected');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ recursionDepth: 2 })))).toBe('recursion_depth_exceeded');
    expect(codeOf(() => normalizeContextFoldResult(completedResult({ summary: 'x'.repeat(CONTEXT_FOLDING_LIMITS.foldResultMaxChars + 1), structuredOutput: null })))).toBe('limit_exceeded');
  });

  it('keeps timeout, cancel, partial, failed and unknown as distinct states that must explain themselves', () => {
    const base = { evidenceRefs: [], structuredOutput: null };
    expect(normalizeContextFoldResult(completedResult({ ...base, status: 'timeout', blockers: ['child exceeded 60000ms'] })).status).toBe('timeout');
    expect(normalizeContextFoldResult(completedResult({ ...base, status: 'cancelled', failedAttempts: [{ tool: 'exec', reason: 'cancelled by parent', at: NOW }] })).status).toBe('cancelled');
    expect(normalizeContextFoldResult(completedResult({ ...base, status: 'unknown', diagnostics: [{ code: 'unknown_delivery', message: 'child run not found' }] })).status).toBe('unknown');
    expect(normalizeContextFoldResult(completedResult({ ...base, status: 'partial', unresolvedClaims: ['could not run tests'] })).status).toBe('partial');
    expect(normalizeContextFoldResult(completedResult({ ...base, status: 'failed', failedAttempts: [{ tool: 'context_expand', reason: 'stale_checksum' }] })).status).toBe('failed');
    for (const status of ['timeout', 'cancelled', 'partial', 'failed', 'unknown'] as const) {
      expect(codeOf(() => normalizeContextFoldResult(completedResult({ ...base, status }))), status).toBe('invalid_result');
    }
    // A failure never masquerades as success: the status is what the child reported, not what the parent hoped.
    expect(normalizeContextFoldResult(completedResult({ ...base, status: 'timeout', blockers: ['timeout'] })).status).not.toBe('completed');
  });

  it('projects for the parent within budget without ever carrying a transcript', () => {
    const exact = projectContextFoldResultForParent(completedResult());
    expect(exact.truncated).toBe(false);
    expect(exact.projection.rawChildTranscriptChars).toBe(0);
    expect(exact.chars).toBe(exact.projection.outputChars);

    const longSummary = 'summary '.repeat(600);
    const truncated = projectContextFoldResultForParent(completedResult({ summary: longSummary, structuredOutput: { k: 'v' } }), { maxChars: 1_000 });
    expect(truncated.truncated).toBe(true);
    expect(truncated.chars).toBeLessThanOrEqual(1_000);
    expect(truncated.projection.structuredOutput).toEqual({ k: 'v' });
    expect(truncated.projection.diagnostics.some((item) => item.code === 'limit_exceeded')).toBe(true);
    expect(truncated.projection.outputChars).toBe(measureContextFoldOutputChars(truncated.projection.summary, truncated.projection.structuredOutput));

    const bigStructured = projectContextFoldResultForParent(completedResult({ summary: 'short', structuredOutput: { blob: 'y'.repeat(3_000) } }), { maxChars: 500 });
    expect(bigStructured.projection.structuredOutput).toBeNull();
    expect(bigStructured.projection.summary).toBe('short');
    expect(bigStructured.chars).toBeLessThanOrEqual(500);

    // The projection is itself a valid result and re-projecting is idempotent.
    const again = projectContextFoldResultForParent(truncated.projection, { maxChars: 1_000 });
    expect(again.projection.summary).toBe(truncated.projection.summary);
    expect(again.truncated).toBe(false);
    expect(codeOf(() => projectContextFoldResultForParent(completedResult(), { maxChars: CONTEXT_FOLDING_LIMITS.foldResultMaxChars + 1 }))).toBe('limit_exceeded');
    expect(codeOf(() => projectContextFoldResultForParent(completedResult({ transcript: 'x' })))).toBe('raw_transcript_rejected');
  });

  it('names duplicate and unknown deliveries instead of accepting them', () => {
    const ledger = createContextFoldDeliveryLedger();
    ledger.expect('cff_0123456789abcdef0123456789abcdef', 'run-child-1');
    expect(ledger.accept({ foldId: 'cff_0123456789abcdef0123456789abcdef', childRunId: 'run-child-1', deliveryId: 'd1' })).toBe('accepted');
    expect(ledger.accept({ foldId: 'cff_0123456789abcdef0123456789abcdef', childRunId: 'run-child-1', deliveryId: 'd1' })).toBe('duplicate');
    expect(ledger.accept({ foldId: 'cff_0123456789abcdef0123456789abcdef', childRunId: 'run-child-1', deliveryId: 'd2' })).toBe('duplicate');
    expect(ledger.accept({ foldId: 'cff_0123456789abcdef0123456789abcdef', childRunId: 'run-stranger', deliveryId: 'd3' })).toBe('unknown');
    expect(ledger.accept({ foldId: 'cff_ffffffffffffffffffffffffffffffff', childRunId: 'run-child-1', deliveryId: 'd4' })).toBe('unknown');
    expect(ledger.snapshot()).toEqual([{ foldId: 'cff_0123456789abcdef0123456789abcdef', childRunId: 'run-child-1', deliveryId: 'd1' }]);
  });
});

type Baseline = {
  schemaVersion: string;
  provenance: { commit: string; dirtyAtCapture: string[] };
  dcsContextTools: { names: string[]; serializedFull: string; serializedSummary: string; perTool: Record<string, string> };
  dcsToolNameConstants: { all: string[]; agent: string[]; view: string[] };
  codingToolNavigation: {
    summaryByName: Record<string, string>;
    factToolNames: string[];
    routingPrompt: string;
    navigationLine: string;
    routingHints: string[];
    navPromptMaxChars: number;
    defaultNavPrompt: string;
  };
  toolCatalogIds: string[];
  openClawTools: { names: string[]; perToolSha256: Record<string, string> };
};

const sha = (text: string) => `sha256:${hash(text)}`;
const stable = (value: unknown): unknown => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((accumulator, key) => {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) accumulator[key] = stable(item);
      return accumulator;
    }, {})
    : value;
type ToolShape = { name: string; description?: string; parameters?: unknown; label?: string; displaySummary?: string; risk?: unknown };
const serializeTool = (tool: ToolShape) => JSON.stringify(stable({
  name: tool.name, label: tool.label, displaySummary: tool.displaySummary, description: tool.description, parameters: tool.parameters, risk: tool.risk,
}));

function flagOffDcsTools() {
  const blockStore = { query: async () => [], queryByEntity: async () => [], recallArchivedBlocks: async () => [] };
  const sink = async () => [];
  return createDcsContextAgentTools({
    sessionId: 'sess-parity',
    blockStore: blockStore as never,
    contextBlockSink: sink as never,
    workspaceRoot: 'D:/tmp/parity-root',
  });
}

describe('flag-off byte parity against the clean-HEAD baseline', () => {
  const baseline = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/unit/fixtures/context-folding/off-mode-baseline.json'), 'utf8')) as Baseline;

  afterEach(() => {
    delete process.env[CONTEXT_FOLDING_ENV];
  });

  it('was captured at a clean commit of this track before any runtime change', () => {
    expect(baseline.schemaVersion).toBe('ContextFoldingOffModeBaseline/v1');
    expect(baseline.provenance.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(baseline.provenance.dirtyAtCapture).toEqual([]);
    expect(isContextFoldingEnabled({}, {})).toBe(false);
  });

  it('keeps the DCS context tool surface byte-identical with the flag unset and with the flag explicitly off', () => {
    for (const envValue of [undefined, '0', 'false', 'off']) {
      if (envValue === undefined) delete process.env[CONTEXT_FOLDING_ENV];
      else process.env[CONTEXT_FOLDING_ENV] = envValue;
      const tools = flagOffDcsTools();
      expect(tools.map((tool) => tool.name), `env=${String(envValue)}`).toEqual(baseline.dcsContextTools.names);
      expect(serializeContextToolSchemas(tools, 'full'), `env=${String(envValue)}`).toBe(baseline.dcsContextTools.serializedFull);
      expect(serializeContextToolSchemas(tools, 'summary'), `env=${String(envValue)}`).toBe(baseline.dcsContextTools.serializedSummary);
      expect(Object.fromEntries(tools.map((tool) => [tool.name, serializeTool(tool as ToolShape)])), `env=${String(envValue)}`).toEqual(baseline.dcsContextTools.perTool);
    }
  });

  it('keeps frozen coding navigation bytes and the Task System catalog registration', () => {
    expect([...DCS_ALL_CONTEXT_TOOL_NAMES]).toEqual(baseline.dcsToolNameConstants.all);
    expect([...DCS_CONTEXT_AGENT_TOOL_NAMES]).toEqual(baseline.dcsToolNameConstants.agent);
    expect([...DCS_CONTEXT_VIEW_TOOL_NAMES]).toEqual(baseline.dcsToolNameConstants.view);
    expect(CONTEXT_TOOL_SUMMARY_BY_NAME).toEqual(baseline.codingToolNavigation.summaryByName);
    expect([...CODING_FACT_TOOL_NAMES]).toEqual(baseline.codingToolNavigation.factToolNames);
    expect(CODING_TOOL_ROUTING_PROMPT).toBe(baseline.codingToolNavigation.routingPrompt);
    expect(CODING_TOOL_NAVIGATION_LINE).toBe(baseline.codingToolNavigation.navigationLine);
    expect([...CODING_TOOL_ROUTING_HINTS]).toEqual(baseline.codingToolNavigation.routingHints);
    expect(CODING_NAV_PROMPT_MAX_CHARS).toBe(baseline.codingToolNavigation.navPromptMaxChars);
    expect(buildCodingToolNavigationPrompt()).toBe(baseline.codingToolNavigation.defaultNavPrompt);
    const catalogIds = listCoreToolSections().flatMap((section) => (section as { tools?: Array<{ id: string }> }).tools?.map((tool) => tool.id) ?? []).sort();
    // Task System registered task_control after the frozen folding baseline.
    expect(catalogIds).toEqual([...baseline.toolCatalogIds, 'task_control'].sort());
  });

  it('keeps the full OpenClaw tool list byte-identical with the flag off and never exposes a folding tool', () => {
    for (const envValue of [undefined, '0']) {
      if (envValue === undefined) delete process.env[CONTEXT_FOLDING_ENV];
      else process.env[CONTEXT_FOLDING_ENV] = envValue;
      const tools = createOpenClawTools({ sessionId: 'sess-parity', config: {} } as never) as ToolShape[];
      expect(tools.map((tool) => tool.name), `env=${String(envValue)}`).toEqual(baseline.openClawTools.names);
      expect(Object.fromEntries(tools.map((tool) => [tool.name, sha(serializeTool(tool))])), `env=${String(envValue)}`).toEqual(baseline.openClawTools.perToolSha256);
      expect(tools.some((tool) => tool.name === 'context_expand' || tool.name === 'context_fold'), `env=${String(envValue)}`).toBe(false);
    }
    expect(stableStringifyContextFolding(baseline.openClawTools.names)).toBe(JSON.stringify(baseline.openClawTools.names));
  });
});
