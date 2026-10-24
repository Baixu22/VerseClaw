// @vitest-environment node
/**
 * Locks the TF-0003 default configuration matrix.
 * Product defaults must remain fail-closed / opt-in until graduation criteria are met.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MD_MATRIX_ROWS } from '../fixtures/launch-contract-matrix';
import {
  DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS,
} from '../../openclaw_runtime/src/context-engine/assembler';
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
import {
  isSekbEnabled,
  isSekbShadowEvaluationEnabled,
} from '../../openclaw_runtime/src/knowledge/sekb/feature-flags';
import { resolveCodingAutoVerifyConfig } from '../../openclaw_runtime/src/context-engine/coding-runtime-flags';
import {
  applyBrowserPrivateNetworkDefault,
  isBrowserPrivateNetworkAllowAcknowledged,
} from '../../electron/utils/openclaw-auth';

describe('TF-0003 default configuration matrix', () => {
  const prevAssembly = process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
  const prevBridge = process.env.VERSE_VTOKEN_BRIDGE_ENABLED;
  const prevKill = process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV];
  const prevSekb = process.env.OPENCLAW_SEKB_ENABLED;

  beforeEach(() => {
    delete process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
    delete process.env.VERSE_VTOKEN_BRIDGE_ENABLED;
    delete process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV];
    delete process.env.OPENCLAW_SEKB_ENABLED;
  });

  afterEach(() => {
    if (prevAssembly === undefined) delete process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
    else process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED = prevAssembly;
    if (prevBridge === undefined) delete process.env.VERSE_VTOKEN_BRIDGE_ENABLED;
    else process.env.VERSE_VTOKEN_BRIDGE_ENABLED = prevBridge;
    if (prevKill === undefined) delete process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV];
    else process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] = prevKill;
    if (prevSekb === undefined) delete process.env.OPENCLAW_SEKB_ENABLED;
    else process.env.OPENCLAW_SEKB_ENABLED = prevSekb;
  });

  // FP-P0-03: every surface row in docs/dev/default-config-matrix.md must have a
  // registered default-assertion here. The md is the SoT: this iterates the row list
  // rather than hand-enumerating, so a new md row with no assertion fails the suite.
  describe('FP-P0-03 md row coverage', () => {
    const MATRIX_MD = join(process.cwd(), 'docs/dev/default-config-matrix.md');

    it('every md row is registered in the fixture and still present in the md', () => {
      const md = readFileSync(MATRIX_MD, 'utf-8');
      for (const row of MD_MATRIX_ROWS) {
        expect(md, `md row disappeared: ${row.mdLabel}`).toContain(`**${row.mdLabel}**`);
      }
    });

    it('every md table row has a fixture entry (no silently untested row)', () => {
      const md = readFileSync(MATRIX_MD, 'utf-8');
      // Surface rows are the table lines whose first cell is bolded.
      const mdLabels = md
        .split('\n')
        .map((line) => /^\|\s*\*\*(.+?)\*\*\s*\|/.exec(line)?.[1]?.trim())
        .filter((label): label is string => Boolean(label));
      expect(mdLabels.length).toBeGreaterThanOrEqual(10);
      const registered = new Set(MD_MATRIX_ROWS.map((row) => row.mdLabel));
      const unregistered = mdLabels.filter((label) => !registered.has(label));
      expect(
        unregistered,
        `md rows with no assertion registered in tests/fixtures/launch-contract-matrix.ts: ${unregistered.join(', ')}`,
      ).toEqual([]);
    });

    it('every registered assertion group is actually exercised by a test in this file', () => {
      const self = readFileSync(join(process.cwd(), 'tests/unit/default-config-matrix.test.ts'), 'utf-8');
      for (const row of MD_MATRIX_ROWS) {
        expect(
          self.includes(`[${row.assertedBy}]`),
          `no test tagged [${row.assertedBy}] for md row ${row.mdLabel}`,
        ).toBe(true);
      }
    });
  });

  // FP-P0-07: the "Product default" CELL TEXT is locked byte-for-byte, and the
  // three parties must agree per row: md cell ↔ fixture declaredDefault ↔ the
  // implementation's actual default. Before this, declaredDefault was only an
  // annotation — someone could flip an md cell to `**true**` and no test noticed.
  describe('FP-P0-07 md default-cell text lock (three-way parity)', () => {
    const MATRIX_MD = join(process.cwd(), 'docs/dev/default-config-matrix.md');

    /** Parse `| **Label** | key | default | ...` rows → Map(label → verbatim default cell). */
    function parseMdDefaultCells(): Map<string, string> {
      const md = readFileSync(MATRIX_MD, 'utf-8');
      const cells = new Map<string, string>();
      for (const line of md.split('\n')) {
        const match = /^\|\s*\*\*(.+?)\*\*\s*\|/.exec(line);
        if (!match) continue;
        const columns = line.split('|').map((cell) => cell.trim());
        // columns[0] is the empty string before the leading pipe; col 3 = index 3.
        if (columns.length > 3) cells.set(match[1].trim(), columns[3]);
      }
      return cells;
    }

    /** Normalize a verbatim md cell (`**false** (opt-in)` etc.) to the fixture form. */
    function normalizeMdDefaultCell(cell: string): string {
      const match = /^\*\*(.+?)\*\*(?:\s*\((.+?)\))?$/.exec(cell);
      if (!match) return `<unparseable: ${cell}>`;
      const [, bold, annotation] = match;
      if (annotation === 'deny') return 'deny';
      return bold;
    }

    it('every fixture row matches the md "Product default" cell byte-for-byte', () => {
      const cells = parseMdDefaultCells();
      for (const row of MD_MATRIX_ROWS) {
        const mdCell = cells.get(row.mdLabel);
        expect(
          mdCell,
          `md row "${row.mdLabel}" has no parseable Product default cell`,
        ).toBeDefined();
        expect(
          mdCell,
          `md Product default cell for "${row.mdLabel}" drifted from the fixture. ` +
            `md: ${JSON.stringify(mdCell)} fixture: ${JSON.stringify(row.mdDefaultCell)}. ` +
            'The md is the SoT: if this is a real default change it must go through ' +
            'a graduation decision, not a doc edit.',
        ).toBe(row.mdDefaultCell);
      }
    });

    it('the verbatim cell normalizes to the declaredDefault for every format variant', () => {
      for (const row of MD_MATRIX_ROWS) {
        expect(
          normalizeMdDefaultCell(row.mdDefaultCell),
          `cell ${JSON.stringify(row.mdDefaultCell)} does not normalize to ` +
            `declaredDefault ${JSON.stringify(row.declaredDefault)} for ${row.mdLabel}`,
        ).toBe(row.declaredDefault);
      }
    });

    it('implementation defaults agree with declaredDefault for every row', async () => {
      const { DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS } = await import(
        '../../openclaw_runtime/src/runtime-core/memory-context'
      );
      const { readVtokenBridgeEnabledFromEnv } = await import(
        '../../electron/services/vtoken-bridge'
      );
      // Each probe returns the implementation's default in fixture-normalized form.
      const implProbes: Record<string, () => string> = {
        'VToken assembly': () =>
          DEFAULT_VTOKEN_ASSEMBLY_CONFIG.enabled === false &&
          resolveVtokenAssemblyConfig({}).enabled === false
            ? 'false'
            : 'true',
        'VToken bridge': () => (readVtokenBridgeEnabledFromEnv() === false ? 'false' : 'true'),
        'working-memory': () =>
          DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS['runtime.contextBlock.working_memory.enabled'] ===
          false
            ? 'false'
            : 'true',
        'tool-registry': () =>
          DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS['runtime.contextBlock.tool_registry.enabled'] ===
          false
            ? 'false'
            : 'true',
        'Runtime Memory inject pilot': () =>
          DEFAULT_MEMORY_INJECT_PILOT_CONFIG.enabled === false &&
          resolveMemoryInjectPilotConfig({}).enabled === false
            ? 'false'
            : 'true',
        'Runtime Memory shadow/provider/persist': () =>
          DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS.shadow === false &&
          DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS.provider === false &&
          DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS.persist === false
            ? 'false'
            : 'true',
        'SEKB master': () => (isSekbEnabled({}) === false ? 'false' : 'true'),
        // No enabling key exists at all; master-off means nothing writes back.
        'SEKB auto writeback': () => (isSekbEnabled({}) === false ? 'off' : 'on'),
        'SEKB shadow evaluation': () =>
          isSekbShadowEvaluationEnabled({}) === false ? 'false' : 'true',
        'Browser private network': () => {
          const browser: Record<string, unknown> = {};
          applyBrowserPrivateNetworkDefault(browser);
          return (browser.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork ===
            false
            ? 'deny'
            : 'allow';
        },
        'Context enhancement kill switch': () =>
          isContextEnhancementKillSwitchEngaged({}) === false ? 'false' : 'true',
        'Coding auto verify': () => {
          const enabled = resolveCodingAutoVerifyConfig({}).enabled;
          return enabled === false ? 'false' : enabled === 'auto' ? 'auto' : 'true';
        },
      };
      for (const row of MD_MATRIX_ROWS) {
        const probe = implProbes[row.mdLabel];
        expect(probe, `no implementation probe registered for md row ${row.mdLabel}`).toBeDefined();
        expect(
          probe(),
          `implementation default for "${row.mdLabel}" disagrees with the md-declared ` +
            `default ${JSON.stringify(row.declaredDefault)}`,
        ).toBe(row.declaredDefault);
      }
    });
  });

  it('locks VToken assembly default OFF (opt-in) [vtoken-assembly-default]', () => {
    expect(DEFAULT_VTOKEN_ASSEMBLY_CONFIG.enabled).toBe(false);
    expect(resolveVtokenAssemblyConfig({}).enabled).toBe(false);
    expect(
      resolveVtokenAssemblyConfig({
        runtime: { vtoken: { assembly: { enabled: true } } },
      }).enabled,
    ).toBe(true);
  });

  it('locks working-memory and other DCS context-block flags default OFF [context-block-defaults]', () => {
    expect(DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS['runtime.contextBlock.working_memory.enabled']).toBe(false);
    expect(DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS['runtime.contextBlock.compass.enabled']).toBe(false);
    expect(DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS['runtime.contextBlock.role_memory.enabled']).toBe(false);
    expect(DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS['runtime.contextBlock.tool_registry.enabled']).toBe(false);
  });

  it('locks Runtime Memory inject pilot default OFF [memory-inject-pilot-default]', () => {
    expect(DEFAULT_MEMORY_INJECT_PILOT_CONFIG.enabled).toBe(false);
    expect(resolveMemoryInjectPilotConfig({}).enabled).toBe(false);
  });

  // FP-P0-03: md row "Runtime Memory shadow/provider/persist" — explicit opt-in only.
  it('locks Runtime Memory shadow/provider/persist default OFF [memory-shadow-provider-persist-default]', () => {
    const empty = {} as { runtime?: { memory?: Record<string, unknown> } };
    const memory = empty.runtime?.memory;
    // Omitted config must not read as enabled for any of the three leaves.
    expect(memory?.shadow === true).toBe(false);
    expect(memory?.provider === true).toBe(false);
    expect(memory?.persist === true).toBe(false);
    // Explicit true is the only way in (documented "explicit opt-in only").
    const optIn = { runtime: { memory: { shadow: true, provider: true, persist: true } } };
    expect(optIn.runtime.memory.shadow).toBe(true);
    expect(optIn.runtime.memory.provider).toBe(true);
    expect(optIn.runtime.memory.persist).toBe(true);
  });

  it('locks SEKB master default OFF (no auto writeback graduation) [sekb-master-default]', () => {
    expect(isSekbEnabled({})).toBe(false);
    expect(isSekbEnabled({ runtime: { contextBlock: { sekb: { enabled: true } } } })).toBe(true);
  });

  // FP-P0-03: md row "SEKB auto writeback" — default off with NO config key at all.
  // The matrix says "(none)" / "N/A human confirm only": the absence of an enabling
  // key is the guarantee, so assert no such key is recognized.
  it('keeps SEKB auto writeback off with no enabling flag [sekb-auto-writeback-off]', () => {
    // Master off ⇒ nothing SEKB writes back regardless of other keys.
    expect(isSekbEnabled({})).toBe(false);
    // A hypothetical autoWriteback key must not enable SEKB by itself.
    expect(
      isSekbEnabled({
        runtime: { contextBlock: { sekb: { autoWriteback: true } } },
      } as unknown as Parameters<typeof isSekbEnabled>[0]),
    ).toBe(false);
  });

  // FP-P0-03: md row "SEKB shadow evaluation" — requires master + explicit true.
  it('locks SEKB shadow evaluation default OFF and requires master [sekb-shadow-evaluation-default]', () => {
    expect(isSekbShadowEvaluationEnabled({})).toBe(false);
    // Explicit true without SEKB master must not evaluate.
    expect(
      isSekbShadowEvaluationEnabled({
        runtime: { contextBlock: { sekb: { shadowEvaluation: { enabled: true } } } },
      }),
    ).toBe(false);
    // Master + explicit true is the documented canary path.
    expect(
      isSekbShadowEvaluationEnabled({
        runtime: {
          contextBlock: { sekb: { enabled: true, shadowEvaluation: { enabled: true } } },
        },
      }),
    ).toBe(true);
  });

  it('locks Browser private network default DENY and migrates unacked legacy allow [browser-private-network-default]', () => {
    const browser: Record<string, unknown> = {};
    expect(applyBrowserPrivateNetworkDefault(browser)).toBe(true);
    expect(
      (browser.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork,
    ).toBe(false);

    const partial: Record<string, unknown> = { ssrfPolicy: {} };
    expect(applyBrowserPrivateNetworkDefault(partial)).toBe(true);
    expect(
      (partial.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork,
    ).toBe(false);

    // Legacy true without acknowledgement → fail-closed migrate to false
    const legacy: Record<string, unknown> = {
      ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
    };
    expect(applyBrowserPrivateNetworkDefault(legacy, {})).toBe(true);
    expect(
      (legacy.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork,
    ).toBe(false);
    expect(
      (legacy.ssrfPolicy as Record<string, unknown>).privateNetworkLegacyAllowMigratedAt,
    ).toEqual(expect.any(String));

    // Canary: true + acknowledged stays true
    const acknowledged: Record<string, unknown> = {
      ssrfPolicy: {
        dangerouslyAllowPrivateNetwork: true,
        dangerouslyAllowPrivateNetworkAcknowledged: true,
      },
    };
    expect(applyBrowserPrivateNetworkDefault(acknowledged, {})).toBe(false);
    expect(
      (acknowledged.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork,
    ).toBe(true);
    expect(
      isBrowserPrivateNetworkAllowAcknowledged(
        acknowledged.ssrfPolicy as Record<string, unknown>,
        {},
      ),
    ).toBe(true);

    // Env canary also preserves true
    const envCanary: Record<string, unknown> = {
      ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
    };
    expect(
      applyBrowserPrivateNetworkDefault(envCanary, { VERSE_BROWSER_ALLOW_PRIVATE_NETWORK: '1' }),
    ).toBe(false);
    expect(
      (envCanary.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork,
    ).toBe(true);

    // Legacy alias allowPrivateNetwork:true without ack → migrate
    const aliasLegacy: Record<string, unknown> = {
      ssrfPolicy: { allowPrivateNetwork: true },
    };
    expect(applyBrowserPrivateNetworkDefault(aliasLegacy, {})).toBe(true);
    expect(
      (aliasLegacy.ssrfPolicy as Record<string, unknown>).allowPrivateNetwork,
    ).toBe(false);
    expect(
      (aliasLegacy.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork,
    ).toBe(false);

    // Dual-alias unacked true → both denied
    const dualLegacy: Record<string, unknown> = {
      ssrfPolicy: {
        dangerouslyAllowPrivateNetwork: true,
        allowPrivateNetwork: true,
      },
    };
    expect(applyBrowserPrivateNetworkDefault(dualLegacy, {})).toBe(true);
    expect(
      (dualLegacy.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork,
    ).toBe(false);
    expect(
      (dualLegacy.ssrfPolicy as Record<string, unknown>).allowPrivateNetwork,
    ).toBe(false);
  });

  // FP-P0-03: md row "VToken bridge" — default OFF, env=1 or Developer toggle to enable.
  it('locks VToken bridge default OFF (opt-in) [vtoken-bridge-default]', async () => {
    const { readVtokenBridgeEnabledFromEnv } = await import('../../electron/services/vtoken-bridge');
    // No env set (beforeEach deleted it) ⇒ off.
    expect(readVtokenBridgeEnabledFromEnv()).toBe(false);
    process.env.VERSE_VTOKEN_BRIDGE_ENABLED = '1';
    expect(readVtokenBridgeEnabledFromEnv()).toBe(true);
    // Explicit kill wins over the enable form.
    process.env.VERSE_VTOKEN_BRIDGE_ENABLED = '0';
    expect(readVtokenBridgeEnabledFromEnv()).toBe(false);
  });

  // FP-P0-03: md row "Context enhancement kill switch" — default not engaged, both forms work.
  it('locks enhancement kill switch default OFF with env and config forms [enhancement-kill-switch-default]', () => {
    expect(isContextEnhancementKillSwitchEngaged({})).toBe(false);
    expect(isContextEnhancementKillSwitchEngaged(undefined)).toBe(false);
    // Config form (FP-P0-02) must be a real switch, not env-only.
    expect(
      isContextEnhancementKillSwitchEngaged({
        runtime: { contextEnhancement: { killSwitch: true } },
      }),
    ).toBe(true);
    // Env form.
    process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] = '1';
    expect(isContextEnhancementKillSwitchEngaged({})).toBe(true);
  });

  it('locks coding auto verify default to auto-detect and bounds explicit opt-in [coding-auto-verify-default]', () => {
    expect(resolveCodingAutoVerifyConfig({})).toEqual({ enabled: 'auto', timeoutSeconds: 90 });
    expect(
      resolveCodingAutoVerifyConfig({
        runtime: {
          coding: {
            autoVerify: { enabled: true, timeoutSeconds: 30, command: 'pnpm test:changed' },
          },
        },
      }),
    ).toEqual({ enabled: true, timeoutSeconds: 30, command: 'pnpm test:changed' });
  });

  it('kill switch cuts VToken + memory inject fail-closed without requiring throw', () => {
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
  });
});
