// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunEmbeddedAgentParams } from '../../openclaw_runtime/src/agents/embedded-agent-runner/run/params';
import type { EmbeddedRunAttemptParams } from '../../openclaw_runtime/src/agents/embedded-agent-runner/run/types';

const attempt = vi.hoisted(() => ({ calls: [] as Array<{ workspaceId?: string; workspaceFingerprint?: string; workspaceDir: string }> }));
vi.mock('../../openclaw_runtime/src/agents/embedded-agent-runner/run/backend.js', () => ({
  runEmbeddedAttemptWithBackend: vi.fn(async (params: EmbeddedRunAttemptParams) => {
    attempt.calls.push(params);
    throw new Error('A5 scope probe stops before provider execution');
  }),
}));
import { runEmbeddedAgent } from '../../openclaw_runtime/src/agents/embedded-agent-runner/run';
import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { closeOpenClawAgentDatabasesForTest } from '../../openclaw_runtime/src/state/openclaw-agent-db';
import { closeTrackedSqliteHandlesUnder } from '../../openclaw_runtime/src/infra/node-sqlite';
import { createFollowupRunner } from '../../openclaw_runtime/src/auto-reply/reply/followup-runner';
import { createTypingController } from '../../openclaw_runtime/src/auto-reply/reply/typing';

let root: string | undefined;
afterEach(() => {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabase();
  if (root) { closeTrackedSqliteHandlesUnder(root); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  root = undefined;
  attempt.calls.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('TF-0674 orchestration to attempt workspace identity', () => {
  it.each([
    { entry: 'direct', scoped: true }, { entry: 'direct', scoped: false },
    { entry: 'queued', scoped: true }, { entry: 'queued', scoped: false },
  ])('preserves owner scope without inferring an ID from a path ($entry, scoped=$scoped)', async ({ entry, scoped }) => {
    root = mkdtempSync(join(tmpdir(), 'clawx-a5-scope-'));
    const workspaceDir = join(root, 'workspace');
    const agentDir = join(root, 'agent');
    mkdirSync(workspaceDir);
    mkdirSync(agentDir);
    vi.stubEnv('OPENCLAW_HOME', join(root, 'home'));
    vi.stubEnv('OPENCLAW_STATE_DIR', join(root, 'state'));
    const scope = scoped ? { workspaceId: 'workspace:a5-owner-id', workspaceFingerprint: 'sha256:a5-owner-fingerprint' } : {};
    const identity = `${entry}-${scoped ? 'scoped' : 'legacy'}`;
    const params: RunEmbeddedAgentParams = {
      sessionId: `a5-scope-${identity}`, sessionKey: `agent:main:a5-scope-${identity}`,
      sessionFile: join(root, 'session.jsonl'), workspaceDir, agentDir, ...scope,
      config: {
        models: { mode: 'merge', providers: { openai: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only', api: 'openai-completions', models: [{ id: 'a5-scope-fixture', name: 'A5 scope fixture', api: 'openai-completions', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 128 }] } } },
        agents: { defaults: { workspace: workspaceDir, model: { primary: 'openai/a5-scope-fixture' } } },
      },
      prompt: 'scope forwarding probe', provider: 'openai', model: 'a5-scope-fixture',
      agentHarnessId: 'openclaw', timeoutMs: 20_000, runId: `a5-scope-run-${identity}`,
      enqueue: (task) => task(),
      disableTools: true, disableMessageTool: true, modelRun: true, promptMode: 'none',
      cleanupBundleMcpOnRunEnd: true,
    };
    // Only the provider execution boundary is intercepted; production run setup
    // must reach that boundary and supply the actual owner-resolved parameters.
    if (entry === 'direct') {
      await runEmbeddedAgent(params).catch(() => undefined);
    } else {
      const facade = await import('../../openclaw_runtime/src/agents/embedded-agent');
      // Keep the queue's real admission and run composition; isolate scheduling
      // with the same existing injection point as the direct-entry probe.
      vi.spyOn(facade, 'runEmbeddedAgent').mockImplementation(runParams => runEmbeddedAgent({ ...runParams, enqueue: task => task() }));
      const followup = createFollowupRunner({
        typing: createTypingController({}), typingMode: 'never', defaultModel: 'a5-scope-fixture',
        sessionKey: params.sessionKey, sessionEntry: { sessionId: params.sessionId, updatedAt: Date.now() },
        opts: { disableTools: true, onBlockReply: async () => {} },
      });
      await followup({
        prompt: params.prompt, enqueuedAt: Date.now(),
        run: {
          sessionId: params.sessionId, sessionKey: params.sessionKey, sessionFile: params.sessionFile,
          workspaceDir, ...scope, agentId: 'main', agentDir, config: params.config!,
          provider: 'openai', model: 'a5-scope-fixture', timeoutMs: params.timeoutMs, blockReplyBreak: 'text_end',
        },
      }).catch(() => undefined);
    }
    expect(attempt.calls).toHaveLength(1);
    expect(attempt.calls[0]).toMatchObject({ workspaceDir });
    expect(attempt.calls[0].workspaceId).toBe(scope.workspaceId);
    expect(attempt.calls[0].workspaceFingerprint).toBe(scope.workspaceFingerprint);
  }, 60_000);
});
