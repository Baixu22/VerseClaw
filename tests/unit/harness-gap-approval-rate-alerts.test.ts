// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { codingObservability } from '../../openclaw_runtime/src/context-engine/coding-observability';
import { createOpenClawCodingTools } from '../../openclaw_runtime/src/agents/agent-tools';
import { wrapToolWithDestructiveTier } from '../../openclaw_runtime/src/agents/write-destructive-tier';
import type { AnyAgentTool } from '../../openclaw_runtime/src/agents/agent-tools.types';
import { areDiagnosticsEnabledForProcess, setDiagnosticsEnabledForProcess } from '../../openclaw_runtime/src/infra/diagnostic-events';
import { setLoggerOverride, resetLogger } from '../../openclaw_runtime/src/logging/logger';
import { diagnosticLogger } from '../../openclaw_runtime/src/logging/diagnostic-runtime';
import { createDiagnosticLogRecordCapture } from '../../openclaw_runtime/src/logging/test-helpers/diagnostic-log-capture';

let now: number;
let workspace: string;
let logFile: string;
let previousDiagnostics: boolean;
let capture: ReturnType<typeof createDiagnosticLogRecordCapture>;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'clawx-o01-'));
  logFile = join(workspace, 'diagnostic.log');
  now = 100_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  previousDiagnostics = areDiagnosticsEnabledForProcess();
  setDiagnosticsEnabledForProcess(true);
  setLoggerOverride({ level: 'debug', file: logFile, consoleLevel: 'silent' });
  codingObservability.reset();
  capture = createDiagnosticLogRecordCapture();
});
afterEach(async () => {
  await capture.flush();
  capture.cleanup();
  codingObservability.reset();
  setDiagnosticsEnabledForProcess(previousDiagnostics);
  resetLogger();
  vi.restoreAllMocks();
  await rm(workspace, { recursive: true, force: true });
});

function decisions(prompts: number, skips = 0, enabled = true) {
  for (let i = 0; i < prompts; i++) { now++; codingObservability.recordApprovalPrompt(enabled); }
  for (let i = 0; i < skips; i++) { now++; codingObservability.recordApprovalSkip(enabled); }
}
function rate() { return codingObservability.approvalRateDiagnostics(); }
function records() { return capture.records.filter(r => r.attributes?.metric === 'coding.write.approvalPromptRate'); }

describe('O01 bounded classification windows, not approval authority', () => {
  it('keeps the old counter/rate shapes and defaults to no monitor', () => {
    expect(rate()).toMatchObject({ status: 'disabled', sampleCount: 0, approvalPromptRate: null });
    codingObservability.recordApprovalPrompt();
    codingObservability.recordApprovalSkip();
    expect(codingObservability.rates().approvalPromptRate).toBe(0.5);
    expect(codingObservability.snapshot()).toMatchObject({ approvalPrompts: 1, approvalSkips: 1 });
    expect(rate().status).toBe('disabled');
  });
  it('does not report insufficient samples as a measured healthy rate', () => {
    decisions(19);
    expect(rate()).toMatchObject({ status: 'unavailable', sampleCount: 19, approvalPromptRate: null, rateMeasured: false });
  });
  it('requires two distinct high windows, even with repeated reads/reports', () => {
    decisions(20);
    const emitted: unknown[] = [];
    for (let i = 0; i < 5; i++) { rate(); codingObservability.reportApprovalRateDiagnostic(e => emitted.push(e)); }
    expect(rate()).toMatchObject({ status: 'observing', evaluatedAtSequence: 20 });
    expect(emitted).toHaveLength(1);
    decisions(20);
    expect(rate()).toMatchObject({ status: 'alert', reason: 'high_rate_confirmed', sampleCount: 40, approvalPromptRate: 1 });
  });
  it('uses inclusive high threshold and resets confirmation in the middle band', () => {
    decisions(10, 10);
    expect(rate().status).toBe('observing');
    decisions(10, 10);
    expect(rate()).toMatchObject({ status: 'alert', approvalPromptRate: 0.5 });
    codingObservability.reset();
    decisions(10, 10);
    decisions(8, 12); // 18/40=.45 breaks the high streak.
    decisions(20);
    expect(rate().status).toBe('observing');
    decisions(20);
    expect(rate().status).toBe('alert');
  });
  it('retains alert until two low windows, then clears using the last 100 decisions', () => {
    decisions(40);
    decisions(0, 80);
    expect(rate()).toMatchObject({ status: 'alert', sampleCount: 100, approvalPromptRate: 0.2 });
    decisions(0, 20);
    expect(rate()).toMatchObject({ status: 'observing', reason: 'low_rate_confirmed', promptCount: 0, skipCount: 100, approvalPromptRate: 0 });
    expect(codingObservability.rates().approvalPromptRate).toBe(40 / 140);
  });
  it('keeps the low threshold inclusive at .3', () => {
    decisions(40);
    decisions(0, 20);
    decisions(0, 20);
    decisions(0, 10); decisions(10);
    // At sequence120, the last100 are 30 prompts/70 skips: first low window.
    decisions(0, 20);
    expect(rate()).toMatchObject({ status: 'alert', approvalPromptRate: 0.3 });
    decisions(0, 20);
    expect(rate().status).toBe('observing');
  });
  it.each([10_000, 15_000])('preserves cadence through TTL turnover at %sms per decision', interval => {
    for (let i = 0; i < 40; i++) { now += interval; codingObservability.recordApprovalPrompt(true); }
    expect(rate()).toMatchObject({ status: 'alert', evaluatedAtSequence: 40 });
  });
  it.each([300_000, 300_001, 350_000])('does not bridge a coverage gap concealed by an arrival at %sms', arrival => {
    now = 0;
    for (let i = 0; i < 20; i++) codingObservability.recordApprovalPrompt(true);
    now = 100_000;
    for (let i = 0; i < 19; i++) codingObservability.recordApprovalPrompt(true);
    now = arrival; codingObservability.recordApprovalPrompt(true);
    expect(rate()).toMatchObject({ status: arrival === 300_000 ? 'alert' : 'observing', sampleCount: 20, evaluatedAtSequence: 40, approvalPromptRate: 1 });
    decisions(20); expect(rate().status).toBe('alert');
  });
  it('does not emit a low-rate clear by reusing confirmation from before a concealed coverage gap', () => {
    now = 0;
    for (let i = 0; i < 40; i++) codingObservability.recordApprovalPrompt(true);
    for (let i = 0; i < 80; i++) codingObservability.recordApprovalSkip(true);
    expect(rate().status).toBe('alert');
    now = 100_000;
    for (let i = 0; i < 19; i++) codingObservability.recordApprovalSkip(true);
    now = 350_000; codingObservability.recordApprovalSkip(true);
    expect(rate()).toMatchObject({ status: 'observing', reason: 'observing', sampleCount: 20, approvalPromptRate: 0 });
  });
  it('can clear during continuous TTL turnover', () => {
    for (let i = 0; i < 40; i++) { now += 5_000; codingObservability.recordApprovalPrompt(true); }
    expect(rate().status).toBe('alert');
    for (let i = 0; i < 80; i++) { now += 5_000; codingObservability.recordApprovalSkip(true); }
    expect(rate()).toMatchObject({ status: 'observing', reason: 'low_rate_confirmed', evaluatedAtSequence: 120 });
  });
  it('does not confirm undersampled windows during TTL turnover', () => {
    for (let i = 0; i < 40; i++) { now += 20_000; codingObservability.recordApprovalPrompt(true); }
    expect(rate()).toMatchObject({ status: 'unavailable', approvalPromptRate: null });
    decisions(5); expect(rate()).toMatchObject({ status: 'observing', reason: 'observing' });
    decisions(15); expect(rate().status).toBe('observing');
    decisions(20); expect(rate().status).toBe('alert');
  });
  it('expires at TTL instead of clearing to healthy, then requires fresh confirmations', () => {
    decisions(40);
    now += 300_000;
    expect(rate()).toMatchObject({ status: 'unavailable', reason: 'expired_window', sampleCount: 0, approvalPromptRate: null, alertActive: null });
    decisions(20); expect(rate().status).toBe('observing');
    decisions(20); expect(rate().status).toBe('alert');
  });
  it.each([NaN, Infinity, -1])('keeps invalid clock %s unavailable without losing cumulative counts', clock => {
    decisions(40); now = clock; codingObservability.recordApprovalPrompt(true);
    expect(rate()).toMatchObject({ status: 'unavailable', approvalPromptRate: null });
    expect(codingObservability.snapshot().approvalPrompts).toBe(41);
  });
  it('resets confirmation after a backwards clock', () => {
    decisions(20); now -= 100; codingObservability.recordApprovalPrompt(true);
    expect(rate()).toMatchObject({ status: 'unavailable', reason: 'clock_regression' });
    decisions(20); expect(rate().status).toBe('observing');
  });
  it('bounds storage and does not replay disabled history on re-enable', () => {
    decisions(500); expect(rate().sampleCount).toBe(100);
    decisions(1, 0, false); expect(rate().status).toBe('disabled');
    decisions(1); expect(rate()).toMatchObject({ status: 'unavailable', sampleCount: 1 });
    expect(codingObservability.snapshot().approvalPrompts).toBe(502);
    codingObservability.reset(); expect(rate().sampleCount).toBe(0);
  });
  it('retries a throwing consumer without acknowledging the lost notification', () => {
    decisions(40); const sink = vi.fn().mockImplementationOnce(() => { throw new Error('synthetic consumer failure'); });
    expect(() => codingObservability.reportApprovalRateDiagnostic(sink)).not.toThrow();
    codingObservability.reportApprovalRateDiagnostic(sink);
    codingObservability.reportApprovalRateDiagnostic(sink);
    expect(sink).toHaveBeenCalledTimes(2);
  });
  it('returns detached diagnostics that cannot mutate the monitor', () => {
    decisions(40); const current = rate(); current.sampleCount = 0;
    expect(rate().sampleCount).toBe(40);
  });
});

function tools(enabled?: boolean, journalEnabled = false) {
  return createOpenClawCodingTools({
    cwd: workspace, workspaceDir: workspace,
    config: enabled === undefined ? undefined : { diagnostics: { enabled } },
    writeJournalEnabled: journalEnabled,
    toolConstructionPlan: { includeBaseCodingTools: true, includeShellTools: false, includeChannelTools: false, includeOpenClawTools: false, includePluginTools: false },
  });
}
function writeTool(enabled?: boolean, journalEnabled = false) {
  const tool = tools(enabled, journalEnabled).find(t => t.name === 'write');
  if (!tool) throw new Error('real write tool missing');
  return tool;
}

describe('O01 real production composition and existing diagnostic log consumer', () => {
  it.each([undefined, false])('does not opt in when config is %s', async enabled => {
    const tool = writeTool(enabled);
    await tool.execute('off', { path: join(workspace, 'off.txt'), content: 'written' });
    await capture.flush();
    expect(await readFile(join(workspace, 'off.txt'), 'utf8')).toBe('written');
    expect(rate().status).toBe('disabled');
    expect(records()).toHaveLength(0);
  });
  it('honors the process-wide diagnostic kill switch even for explicit config', async () => {
    setDiagnosticsEnabledForProcess(false);
    await writeTool(true).execute('disabled', { path: join(workspace, 'off.txt'), content: 'written' });
    expect(rate().status).toBe('disabled');
    await capture.flush(); expect(records()).toHaveLength(0);
  });
  it('runs real writes through factory → classification → warning → clear and keeps the old effect/approval semantics', async () => {
    const high = writeTool(true, false); const low = writeTool(true, true);
    const path = join(workspace, 'work.txt');
    const rows: unknown[] = [];
    async function step(tool: AnyAgentTool, id: string, content: string, journalEnabled: boolean, diagnosticsEnabled = true) {
      now++;
      const result = await tool.execute(id, { path, content });
      const requiresApproval = (result.details as { requires_approval: boolean }).requires_approval;
      expect(requiresApproval).toBe(!journalEnabled);
      const actual = await readFile(path, 'utf8');
      expect(actual).toBe(content);
      const counts = codingObservability.snapshot();
      rows.push({ kind: 'decision', at: now, id, toolName: tool.name, journalEnabled, diagnosticsEnabled, requiresApproval,
        destructiveTier: (result.details as { destructive_tier: string }).destructive_tier,
        destructiveReason: (result.details as { destructive_reason: string }).destructive_reason, content, effectContent: actual,
        counts: { prompts: counts.approvalPrompts, skips: counts.approvalSkips }, diagnostic: rate() });
    }
    for (let i = 0; i < 40; i++) await step(high, 'h-'+i, 'high-'+i, false);
    await capture.flush();
    expect(records().filter(r => r.attributes?.status === 'alert')).toHaveLength(1);
    expect(records().find(r => r.attributes?.status === 'alert')?.attributes).toMatchObject({ sampleCount: 40, promptCount: 40, approvalPromptRate: 1, rateMeasured: true, scope: 'runtime-process', measurement: 'destructive-tier-classification' });
    for (let i = 0; i < 100; i++) await step(low, 'l-'+i, 'low-'+i, true);
    await capture.flush();
    expect(records().filter(r => r.attributes?.reason === 'low_rate_confirmed')).toHaveLength(1);
    expect(codingObservability.snapshot()).toMatchObject({ approvalPrompts: 40, approvalSkips: 100 });
    now += 300_000;
    rows.push({ kind: 'observation', at: now, diagnostic: rate() });
    expect(rate()).toMatchObject({ status: 'unavailable', reason: 'expired_window', approvalPromptRate: null });
    await step(low, 'after-idle', 'after-idle', true);
    await capture.flush();
    expect(records().filter(r => r.attributes?.reason === 'expired_window')).toHaveLength(1);
    for (let i = 0; i < 40; i++) await step(high, 'recovered-'+i, 'recovered-'+i, false);
    await capture.flush();
    expect(records().filter(r => r.attributes?.status === 'alert')).toHaveLength(2);
    await step(writeTool(false), 'rollback', 'rollback', false, false);
    expect(rate().status).toBe('disabled');
    await capture.flush();
    const log = await readFile(logFile, 'utf8');
    const scopedLog = log.split('\n').filter(line => line.includes('coding.write.approvalPromptRate')).join('\n');
    expect(scopedLog).toContain('high_rate_confirmed'); expect(scopedLog).toContain('low_rate_confirmed');
    expect(scopedLog).not.toContain('high-39'); expect(scopedLog).not.toContain('low-99');
    // Explicit test-only retention for independent acceptance; never a runtime state store.
    if (process.env.CLAWX_O01_EVIDENCE_DIR) {
      const dir = resolve(process.env.CLAWX_O01_EVIDENCE_DIR);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'runtime-events.json'), JSON.stringify({ actor: 'codex-o01-fixture', driven_by: 'agent', source: 'synthetic-local-file-tool', rows, logRecords: records() }, null, 2)+'\n');
      await writeFile(join(dir, 'diagnostic.log'), scopedLog+'\n');
    }
  });
  it('retains the original rejected effect while still counting the attempted classification', async () => {
    decisions(39);
    const failure = new Error('original tool failure');
    const tool = { name: 'write', label: 'fixture', description: 'fixture', parameters: {}, execute: async () => { throw failure; } } as AnyAgentTool;
    const wrapped = wrapToolWithDestructiveTier(tool, { journalEnabled: false, approvalRateDiagnosticsEnabled: true });
    await expect(wrapped.execute('failed', {})).rejects.toBe(failure);
    expect(codingObservability.snapshot().approvalPrompts).toBe(40);
    await capture.flush();
    expect(records().filter(r => r.attributes?.status === 'alert')).toHaveLength(1);
  });
  it('does not turn logging failure into a blocked/repeated effect', async () => {
    decisions(39); let effects = 0;
    const original = diagnosticLogger.warn;
    vi.spyOn(diagnosticLogger, 'warn').mockImplementationOnce(() => { throw new Error('synthetic log failure'); }).mockImplementation(original);
    const tool = { name: 'write', label: 'fixture', description: 'fixture', parameters: {}, execute: async () => { effects++; return { content: [{ type: 'text', text: 'ok' }], details: {} }; } } as AnyAgentTool;
    const wrapped = wrapToolWithDestructiveTier(tool, { journalEnabled: false, approvalRateDiagnosticsEnabled: true });
    await expect(wrapped.execute('same-id', { content: 'private' })).resolves.toMatchObject({ details: { requires_approval: true } });
    await wrapped.execute('same-id', { content: 'private' }); // retries are still classification invocations, not unique UI prompts
    await capture.flush();
    expect(effects).toBe(2); expect(codingObservability.snapshot().approvalPrompts).toBe(41);
    expect(records().filter(r => r.attributes?.status === 'alert')).toHaveLength(1);
  });
});
