// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw.js';
import type { SessionEntry } from '../../openclaw_runtime/src/config/sessions/types.js';
import type { AnyAgentTool } from '../../openclaw_runtime/src/agents/tools/common.js';
import { buildAnthropicCliBackend } from '../../openclaw_runtime/extensions/anthropic/cli-backend.js';
import {
  buildRuntimeEffectiveCapabilityProfile,
  clearRuntimeEffectiveCapabilitySnapshotsForTests,
} from '../../openclaw_runtime/src/agents/runtime-effective-capability.js';
import { buildSessionEffectivePolicy } from '../../openclaw_runtime/src/agents/session-effective-policy.js';
import { buildRuntimeFlagAck } from '../../openclaw_runtime/src/context-engine/runtime-flag-ack.js';

const NOW = Date.parse('2026-10-23T02:00:00.000Z');
const WORKSPACE_ID = 'workspace:long-session-b1';
const SESSION_KEY = 'agent:main:long-session-b1';
const GENERATION = 'gateway-b1';

function tool(name: string): AnyAgentTool {
  return {
    name,
    label: name,
    description: `${name} fixture`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  } as unknown as AnyAgentTool;
}

function cfg(): OpenClawConfig {
  return {
    tools: { exec: { mode: 'full' } },
    agents: {
      defaults: { compaction: { model: 'openclaw-compactor' } },
    },
  } as OpenClawConfig;
}

function ack() {
  return {
    ...buildRuntimeFlagAck({ env: { VERSE_CLAW_GATEWAY_GENERATION: GENERATION } }),
    gatewayGeneration: GENERATION,
    degradedReason: null,
    answeredAt: new Date(NOW).toISOString(),
  };
}

function entry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: 'session-b1',
    updatedAt: NOW,
    providerOverride: 'openai',
    modelOverride: 'gpt-5.4',
    modelProvider: 'openai',
    model: 'gpt-5.4',
    thinkingLevel: 'high',
    queueMode: 'followup',
    queueCap: 12,
    queueDebounceMs: 250,
    queueDrop: 'summarize',
    spawnDepth: 0,
    subagentControlScope: 'children',
    inheritedToolAllow: ['exec'],
    inheritedToolDeny: ['browser'],
    contextBudgetStatus: {
      schemaVersion: 1,
      source: 'pre-prompt-estimate',
      updatedAt: NOW,
      provider: 'openai',
      model: 'gpt-5.4',
      route: 'fits',
      shouldCompact: false,
      estimatedPromptTokens: 12_000,
      contextTokenBudget: 128_000,
      promptBudgetBeforeReserve: 120_000,
      reserveTokens: 8_000,
      effectiveReserveTokens: 8_000,
      remainingPromptBudgetTokens: 108_000,
      overflowTokens: 0,
      toolResultReducibleChars: 0,
      messageCount: 14,
      unwindowedMessageCount: 14,
    },
    ...overrides,
  };
}

async function recordRuntimeFacts(nowMs = NOW): Promise<void> {
  await buildRuntimeEffectiveCapabilityProfile({
    workspaceId: WORKSPACE_ID,
    workspaceDir: 'D:/tmp/long-session-b1-workspace',
    sessionKey: SESSION_KEY,
    runtimeGeneration: GENERATION,
    tools: [tool('exec'), tool('memory_query')],
    cfg: cfg(),
    env: { VERSE_CLAW_GATEWAY_GENERATION: GENERATION },
    runtimeAck: ack(),
    grants: [{
      capabilityId: 'component.coding-execution-backend',
      actionIds: ['exec'],
      grantId: 'grant-b1',
      state: 'active',
      expiresAt: null,
    }],
    memory: { scope: 'workspace', read: 'allowed', write: 'denied', candidate: 'available' },
    knowledge: { appliedState: 'applied', version: 'knowledge-b1', digest: 'sha256:knowledge-b1' },
    nowMs: () => nowMs,
  });
}

let tempDir = '';

beforeEach(() => {
  clearRuntimeEffectiveCapabilitySnapshotsForTests();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'long-session-b1-'));
});

afterEach(() => {
  clearRuntimeEffectiveCapabilitySnapshotsForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('SessionEffectivePolicy/v1', () => {
  it('projects configured and current effective facts from TF-0512 without secrets', async () => {
    await recordRuntimeFacts();
    const policy = await buildSessionEffectivePolicy({
      cfg: cfg(),
      entry: entry(),
      workspaceId: WORKSPACE_ID,
      sessionKey: SESSION_KEY,
      permissionMode: 'acceptEdits',
      expectedRuntimeGeneration: GENERATION,
      nowMs: () => NOW,
    });

    expect(policy.schemaVersion).toBe('SessionEffectivePolicy/v1');
    expect(policy.generation.state).toBe('current');
    expect(policy.backend.configured).toMatchObject({ state: 'configured', value: 'openclaw' });
    expect(policy.backend.effective.value).toMatchObject({ kind: 'openclaw-embedded', model: 'gpt-5.4' });
    expect(policy.backend.binding.state).toBe('effective');
    expect(policy.model.configured.state).toBe('configured');
    expect(policy.model.effective.value).toEqual({ provider: 'openai', model: 'gpt-5.4' });
    expect(policy.model.effort).toMatchObject({ state: 'effective', value: 'high' });
    expect(policy.grant.mode).toMatchObject({ state: 'effective', value: 'acceptEdits' });
    expect(policy.grant.effectiveActions.state).toBe('effective');
    expect(policy.grant.effectiveActions.value?.allowed).toContain('exec');
    expect(policy.limits.context.state).toBe('effective');
    expect(policy.limits.queue).toMatchObject({ state: 'configured', value: { cap: 12 } });
    expect(policy.limits.resources).toMatchObject({ state: 'configured', value: { inheritedToolAllowCount: 1 } });
    expect(policy.limits.schedule.state).toBe('unsupported');
    expect(JSON.stringify(policy)).not.toMatch(/apiKey|authProfileId|access[_-]?token|promptText/i);
  });

  it('keeps effective facts unknown when the runtime snapshot is missing', async () => {
    const policy = await buildSessionEffectivePolicy({
      cfg: cfg(),
      entry: entry(),
      workspaceId: WORKSPACE_ID,
      sessionKey: SESSION_KEY,
      permissionMode: 'plan',
      expectedRuntimeGeneration: GENERATION,
      nowMs: () => NOW,
    });
    expect(policy.generation.state).toBe('missing');
    expect(policy.backend.configured.state).toBe('configured');
    expect(policy.backend.effective.state).toBe('unknown');
    expect(policy.grant.effectiveActions.state).toBe('unknown');
    expect(policy.diagnostics.map((entryValue) => entryValue.code)).toContain('runtime-profile-missing');
  });

  it('rejects stale and wrong-generation snapshots instead of reusing old facts', async () => {
    await recordRuntimeFacts();
    const stale = await buildSessionEffectivePolicy({
      cfg: cfg(), entry: entry(), workspaceId: WORKSPACE_ID, sessionKey: SESSION_KEY,
      permissionMode: 'acceptEdits', expectedRuntimeGeneration: GENERATION, nowMs: () => NOW + 30_001,
    });
    expect(stale.generation.state).toBe('stale');
    expect(stale.backend.effective.state).toBe('unknown');
    expect(stale.grant.effectiveActions.state).toBe('unknown');

    const mismatch = await buildSessionEffectivePolicy({
      cfg: cfg(), entry: entry(), workspaceId: WORKSPACE_ID, sessionKey: SESSION_KEY,
      permissionMode: 'acceptEdits', expectedRuntimeGeneration: 'gateway-other', nowMs: () => NOW,
    });
    expect(mismatch.generation.state).toBe('mismatch');
    expect(mismatch.model.effective.state).toBe('unknown');
  });

  it('reports Codex native compaction ownership and ignored OpenClaw overrides', async () => {
    const sessionFile = path.join(tempDir, 'session-b1.jsonl');
    fs.writeFileSync(sessionFile, '{"type":"session","id":"session-b1"}\n', 'utf8');
    fs.writeFileSync(`${sessionFile}.codex-app-server.json`, JSON.stringify({
      schemaVersion: 1,
      threadId: 'thread-b1',
      sessionFile,
      cwd: 'D:/tmp/long-session-b1-workspace',
      model: 'gpt-5.4',
      modelProvider: 'openai',
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    }, null, 2), 'utf8');
    await recordRuntimeFacts();
    const policy = await buildSessionEffectivePolicy({
      cfg: cfg(),
      entry: entry({ agentHarnessId: 'codex', agentRuntimeOverride: 'codex' }),
      workspaceId: WORKSPACE_ID,
      sessionKey: SESSION_KEY,
      permissionMode: 'acceptEdits',
      sessionFile,
      expectedRuntimeGeneration: GENERATION,
      nowMs: () => NOW,
    });
    expect(policy.backend.effective.value).toMatchObject({ kind: 'codex-app-server', nativeThreadId: 'thread-b1' });
    expect(policy.backend.compatibility.nativeCompactionOwner).toBe('backend');
    expect(policy.backend.compatibility.parameters).toEqual([
      expect.objectContaining({ path: 'agents.defaults.compaction', state: 'ignored' }),
    ]);
  });

  it('reports Claude native compaction ownership without exposing the provider CLI binding as a secret', async () => {
    await recordRuntimeFacts();
    const backend = buildAnthropicCliBackend();
    const policy = await buildSessionEffectivePolicy({
      cfg: cfg(),
      entry: entry({
        providerOverride: 'anthropic',
        modelProvider: 'anthropic',
        model: 'claude-sonnet-4-5',
        agentRuntimeOverride: backend.id,
        claudeCliSessionId: 'claude-session-b1',
      }),
      workspaceId: WORKSPACE_ID,
      sessionKey: SESSION_KEY,
      permissionMode: 'acceptEdits',
      expectedRuntimeGeneration: GENERATION,
      nowMs: () => NOW,
    });
    expect(policy.backend.effective.value).toMatchObject({ kind: 'claude-cli', nativeSessionId: 'claude-session-b1' });
    expect(policy.backend.compatibility.nativeCompactionOwner).toBe('backend');
    expect(policy.backend.compatibility.parameters[0]).toMatchObject({ state: 'ignored' });
  });
});
