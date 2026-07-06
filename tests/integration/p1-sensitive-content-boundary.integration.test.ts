import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';
import {
  findSensitiveContentBoundary,
} from '@shared/sensitive-content-boundary';
import { findCapabilityClaim } from '@shared/capability-claims';
import { createCodeReviewApi } from '@electron/services/code-review-api';
import { roleOrchestrationHandlers } from '../../openclaw_runtime/src/gateway/server-methods/role-orchestration-methods';
import { clearMemoryCards, setMemoryStorePath } from '../../openclaw_runtime/src/memory/memory-store';
import { redactTranscriptMessage } from '../../openclaw_runtime/src/agents/transcript-redact';
import {
  buildDeterministicCompressionArtifact,
  renderCompressionArtifactSummary,
  renderRecoveryContextProjection,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact';
import {
  buildHandlerArgs,
  emptyConfig,
  type CapturedRespond,
} from '../unit/helpers/role-gateway-test-utils';

const execFileMock = vi.hoisted(() => vi.fn());
const activeWorkspace = vi.hoisted(() => ({
  profile: null as WorkspaceProfile | null,
}));
const ledgerEvents = vi.hoisted(() => ({
  append: vi.fn(),
}));
const traceEvents = vi.hoisted(() => ({
  upsert: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  default: { execFile: execFileMock },
  execFile: execFileMock,
}));

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

vi.mock('@electron/services/task-ledger-service', () => ({
  appendTaskLedgerEvents: ledgerEvents.append,
}));

vi.mock('@electron/services/observability-service', () => ({
  upsertObservabilityTrace: traceEvents.upsert,
}));

vi.mock('../../openclaw_runtime/src/agents/subagent-spawn', () => ({
  spawnSubagentDirect: vi.fn(),
}));

const FAKE_KEY = 'OPENAI_API_KEY=sk-test1234567890ABCDE';

function workspace(): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath: process.cwd(),
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

function mockExec(handler: (args: string[]) => { code?: number; stdout?: string; stderr?: string }) {
  execFileMock.mockImplementation((
    _command: string,
    args: string[],
    _options: unknown,
    callback: (...args: unknown[]) => void,
  ) => {
    const result = handler(args);
    const error = result.code && result.code !== 0 ? { code: result.code } : null;
    callback(error, result.stdout ?? '', result.stderr ?? '');
  });
}

function mockRepoWithPatch(patch: string) {
  mockExec((args) => {
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: `${process.cwd()}\n` };
    if (args[0] === 'status') {
      return {
        stdout: [
          '# branch.head feature/review',
          '1 .M N... 100644 100644 100644 abc abc src/app.ts',
          '',
        ].join('\0'),
      };
    }
    if (args[0] === 'diff' && args[1] === '--cached') return { stdout: '' };
    if (args[0] === 'diff') return { stdout: patch };
    return { stdout: '' };
  });
}

async function callHandler(
  method: string,
  params: Record<string, unknown>,
): Promise<CapturedRespond | undefined> {
  const captured: CapturedRespond[] = [];
  const handler = (roleOrchestrationHandlers as Record<string, (args: unknown) => Promise<void>>)[method];
  if (!handler) throw new Error(`unknown handler: ${method}`);
  await handler(buildHandlerArgs(params, emptyConfig(), captured));
  return captured[0];
}

describe('P1 sensitive content boundary integration smoke', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-p1-sensitive-'));
    setMemoryStorePath(join(tempDir, 'role-memory.sqlite'));
    clearMemoryCards();
    execFileMock.mockReset();
    ledgerEvents.append.mockReset();
    traceEvents.upsert.mockReset();
    activeWorkspace.profile = workspace();
  });

  afterEach(() => {
    delete process.env.OPENCLAW_ROLE_MEMORY_ENABLED;
    clearMemoryCards();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps fake keys out of protected local projections without claiming full-chain plaintext freedom', async () => {
    const transcript = redactTranscriptMessage({
      role: 'user',
      content: `please remember ${FAKE_KEY}`,
    } as never);
    expect(JSON.stringify(transcript)).not.toContain(FAKE_KEY);

    const memory = await callHandler('memory.propose', {
      proposal: {
        content: `Do not store this fake key: ${FAKE_KEY}`,
        type: 'fact',
        scope: 'project',
        confidence: 0.95,
        roleTags: ['security'],
        source: 'user',
        evidenceRefs: [{ type: 'manual', ref: 'p1-sensitive-smoke' }],
      },
    });
    expect(memory?.ok).toBe(true);
    expect(memory?.payload).toMatchObject({ accepted: false, action: 'reject' });
    expect(JSON.stringify(memory?.payload)).not.toContain(FAKE_KEY);

    const patch = [
      'diff --git a/src/app.ts b/src/app.ts',
      '@@ -1,1 +1,1 @@',
      '-export const key = "placeholder";',
      `+export const key = "${FAKE_KEY}";`,
      '',
    ].join('\n');
    mockRepoWithPatch(patch);
    const gatewayManager = new EventEmitter() as EventEmitter & {
      rpc: ReturnType<typeof vi.fn>;
    };
    gatewayManager.rpc = vi.fn(async (method: string, params?: unknown) => {
      if (method === 'agent') {
        const message = (params as { message?: string }).message ?? '';
        expect(message).not.toContain(FAKE_KEY);
        expect(message).toContain('OPENAI_API_KEY');
        return { runId: 'model-run-redacted', sessionKey: 'agent:main:code-review' };
      }
      if (method === 'agent.wait') return { status: 'ok' };
      if (method === 'chat.history') {
        return {
          messages: [{
            role: 'assistant',
            content: JSON.stringify({ summary: 'No issues', findings: [] }),
          }],
        };
      }
      return {};
    });
    const codeReview = createCodeReviewApi({ gatewayManager: gatewayManager as never });
    const review = await codeReview.run({ target: { kind: 'uncommitted' } });
    expect(review.success).toBe(true);

    const artifact = buildDeterministicCompressionArtifact({
      messages: [
        { id: 'user-secret', role: 'user', content: `Continue without preserving ${FAKE_KEY}.` },
        { id: 'assistant-secret', role: 'assistant', content: `Added safeguards after seeing ${FAKE_KEY}.` },
      ] as never,
      summary: [
        '## Goal',
        `Finish P1 closure without echoing ${FAKE_KEY}.`,
        '## Key Decisions',
        `- Keep ${FAKE_KEY} out of recovery summaries.`,
        '## Next Steps',
        '1. Run the P1 sensitive boundary smoke.',
      ].join('\n'),
      modifiedFiles: ['openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts'],
    });
    expect(JSON.stringify(artifact)).not.toContain(FAKE_KEY);
    expect(renderCompressionArtifactSummary(artifact)).not.toContain(FAKE_KEY);
    expect(renderRecoveryContextProjection(artifact)).not.toContain(FAKE_KEY);

    const file = findSensitiveContentBoundary('file');
    expect(file?.safeClaim).toContain('redacted diff projection');
    expect(file?.evidenceRefs).toEqual(expect.arrayContaining([
      'tests/unit/code-review-center.test.ts',
      'tests/integration/p1-sensitive-content-boundary.integration.test.ts',
    ]));

    const compaction = findSensitiveContentBoundary('compaction');
    expect(compaction?.safeClaim).toContain('redact fake key-shaped content');
    expect(compaction?.evidenceRefs).toEqual(expect.arrayContaining([
      'tests/unit/compression-artifact.test.ts',
      'tests/integration/p1-sensitive-content-boundary.integration.test.ts',
    ]));

    const localProtection = findCapabilityClaim('capability-40');
    expect(localProtection?.relatedTaskIds).toEqual(expect.arrayContaining(['P1-11', 'P1-12']));
    expect(localProtection?.runtimeProof.refs).toContain('tests/integration/p1-sensitive-content-boundary.integration.test.ts');
    expect(localProtection?.knownExclusions).toEqual(expect.arrayContaining([
      expect.stringContaining('No full-chain secret-free guarantee'),
    ]));
  });
});
