// @vitest-environment node
/**
 * P0 production acceptance gate for TF-0001..TF-0005.
 * Fails if controlled-operable baseline regresses or silent tech-debt returns.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyBrowserPrivateNetworkDefault,
  isBrowserPrivateNetworkAllowAcknowledged,
} from '../../electron/utils/openclaw-auth';
import { DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS } from '../../openclaw_runtime/src/context-engine/assembler';
import {
  DEFAULT_MEMORY_INJECT_PILOT_CONFIG,
  resolveMemoryInjectPilotConfig,
} from '../../openclaw_runtime/src/context-engine/chat-turn-memory-injection';
import {
  DEFAULT_VTOKEN_ASSEMBLY_CONFIG,
  resolveVtokenAssemblyConfig,
} from '../../openclaw_runtime/src/context-engine/chat-turn-vtoken-injection';
import {
  CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV,
  isContextEnhancementKillSwitchEngaged,
} from '../../openclaw_runtime/src/context-engine/enhancement-kill-switch';
import { isSekbEnabled } from '../../openclaw_runtime/src/knowledge/sekb/feature-flags';
const ROOT = resolve(process.cwd());

describe('P0 production acceptance gate (TF-0001..0005)', () => {
  it('build:vite regenerates ignored extension bridges in a clean checkout', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(ROOT, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.['prebuild:vite']).toContain('node scripts/generate-ext-bridge.mjs');
    expect(packageJson.scripts?.['prebuild:vite']).toContain('node scripts/sync-lobe-icons.mjs');
  });

  it('evidence pack exists for every P0 node', () => {
    for (const rel of [
      'docs/dev/context-orchestrator.md',
      'docs/dev/default-config-matrix.md',
      'docs/dev/sekb-golden-path.md',
      'docs/dev/browser-security-recovery.md',
      'docs/dev/tf0001-controlled-operable-closeout.md',
      'artifacts/sekb-golden-path/evidence.json',
      'artifacts/browser-security-recovery/evidence.json',
      'artifacts/tf0001-closeout/evidence.json',
    ]) {
      expect(existsSync(resolve(ROOT, rel)), rel).toBe(true);
    }
  });

  it('production attempt uses orchestrator only and gates CVK addition', () => {
    const src = readFileSync(
      resolve(ROOT, 'openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts'),
      'utf8',
    );
    expect(src).toMatch(/computeContextExtraSystemPrompt/);
    expect(src).not.toMatch(/computeMemoryExtraSystemPrompt/);
    expect(src).not.toMatch(/computeVtokenExtraSystemPrompt\s*\(/);
    expect(src).toMatch(/collectContextOrchestratorCandidate/);
    expect(src).toMatch(/sourceId:\s*"cvk-context-engine"/);
    expect(src).toMatch(/isContextEnhancementKillSwitchEngaged/);
  });

  it('defaults remain fail-closed / opt-in', () => {
    expect(DEFAULT_VTOKEN_ASSEMBLY_CONFIG.enabled).toBe(false);
    expect(resolveVtokenAssemblyConfig({}).enabled).toBe(false);
    expect(DEFAULT_MEMORY_INJECT_PILOT_CONFIG.enabled).toBe(false);
    expect(resolveMemoryInjectPilotConfig({}).enabled).toBe(false);
    expect(isSekbEnabled({})).toBe(false);
    expect(DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS['runtime.contextBlock.working_memory.enabled']).toBe(false);
    expect(DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS['runtime.contextBlock.tool_registry.enabled']).toBe(false);
  });

  it('private-network legacy allow is migrated unless acknowledged', () => {
    const legacy: Record<string, unknown> = {
      ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
    };
    expect(applyBrowserPrivateNetworkDefault(legacy, {})).toBe(true);
    expect((legacy.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork).toBe(false);

    const canary: Record<string, unknown> = {
      ssrfPolicy: {
        dangerouslyAllowPrivateNetwork: true,
        dangerouslyAllowPrivateNetworkAcknowledged: true,
      },
    };
    expect(applyBrowserPrivateNetworkDefault(canary, {})).toBe(false);
    expect(
      isBrowserPrivateNetworkAllowAcknowledged(canary.ssrfPolicy as Record<string, unknown>, {}),
    ).toBe(true);
  });

  it('kill switch cuts enhancement resolution', () => {
    const prev = process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV];
    try {
      process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] = '1';
      expect(isContextEnhancementKillSwitchEngaged({})).toBe(true);
      expect(
        resolveVtokenAssemblyConfig({
          runtime: { vtoken: { assembly: { enabled: true } } },
        }).enabled,
      ).toBe(false);
      expect(
        resolveMemoryInjectPilotConfig({
          runtime: { memory: { injectPilot: { enabled: true } } },
        }).enabled,
      ).toBe(false);
    } finally {
      if (prev === undefined) delete process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV];
      else process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] = prev;
    }
  });

  it('close-out verdict remains non-GA', () => {
    const evidence = JSON.parse(
      readFileSync(resolve(ROOT, 'artifacts/tf0001-closeout/evidence.json'), 'utf8'),
    ) as { verdict: Record<string, unknown> };
    expect(evidence.verdict.controlledOperableNonGa).toBe(true);
    expect(evidence.verdict.liveReady).toBe(false);
    expect(evidence.verdict.productApproved).toBe(false);
    expect(evidence.verdict.readyForDefaultFlagGraduation).toBe(false);
    expect(evidence.verdict.jointSystemGa).toBe('NO-GO');
  });

  it('SEKB golden-path evidence forbids auto writeback', () => {
    const evidence = JSON.parse(
      readFileSync(resolve(ROOT, 'artifacts/sekb-golden-path/evidence.json'), 'utf8'),
    ) as { policy?: { autoWriteback?: boolean }; evaluation?: { noAutoWriteback?: boolean } };
    expect(evidence.policy?.autoWriteback ?? false).toBe(false);
    expect(evidence.evaluation?.noAutoWriteback ?? true).toBe(true);
  });

  it('private-network allowPrivateNetwork alias is migrated without ack', () => {
    const alias: Record<string, unknown> = {
      ssrfPolicy: { allowPrivateNetwork: true },
    };
    expect(applyBrowserPrivateNetworkDefault(alias, {})).toBe(true);
    const policy = alias.ssrfPolicy as Record<string, unknown>;
    expect(policy.allowPrivateNetwork).toBe(false);
    expect(policy.dangerouslyAllowPrivateNetwork).toBe(false);
  });

  it('p0 production pass evidence pack is present and non-GA', () => {
    const evidencePath = resolve(ROOT, 'artifacts/p0-production-pass/evidence.json');
    expect(existsSync(evidencePath)).toBe(true);
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
      verdict: Record<string, unknown>;
      fixes?: string[];
    };
    expect(evidence.verdict.productionControlledOperable).toBe(true);
    expect(evidence.verdict.jointSystemGa).toBe('NO-GO');
    expect(evidence.verdict.liveReady).toBe(false);
    expect(evidence.verdict.readyForDefaultFlagGraduation).toBe(false);
    expect(Array.isArray(evidence.fixes) && evidence.fixes.length >= 3).toBe(true);
  });
});
