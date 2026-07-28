// @vitest-environment node
/**
 * FP-P0-03: freeze the launch/kill contract on BOTH sides.
 *
 * Table-driven over `tests/fixtures/launch-contract-matrix.ts`: every row asserts
 * (a) the Electron launch layer produces the expected child env, and (b) the
 * runtime resolver inside the child reaches the expected verdict. A row with no
 * assertion is impossible — the table is iterated, not hand-enumerated.
 *
 * It also parses `docs/dev/default-config-matrix.md` and fails if a covered md row
 * disappears or gains no fixture case, so the md stays the source of truth.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENHANCEMENT_KILL_ENV,
  LAUNCH_CONTRACT_MATRIX,
  MD_ROWS_COVERED_BY_LAUNCH_MATRIX,
  VTOKEN_ASSEMBLY_ENV,
  type LaunchContractCase,
} from '../fixtures/launch-contract-matrix';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => process.cwd()) },
  utilityProcess: { fork: vi.fn() },
}));

const REPO_ROOT = process.cwd();
const MATRIX_MD = join(REPO_ROOT, 'docs/dev/default-config-matrix.md');

/** Object whose `runtime` getter throws — the fail-closed sentinel. */
const UNPARSEABLE_CONFIG: unknown = Object.freeze({
  get runtime(): never {
    throw new Error('unparseable config fixture');
  },
});

function configFor(testCase: LaunchContractCase): unknown {
  if (!testCase.config) return undefined;
  if ((testCase.config as { __unparseable__?: boolean }).__unparseable__) {
    return UNPARSEABLE_CONFIG;
  }
  return testCase.config;
}

async function buildChildEnv(
  operatorEnv: Record<string, string>,
): Promise<Record<string, string | undefined>> {
  const { buildGatewayRuntimeEnv } = await import('@electron/gateway/process-launcher');
  // The launch layer receives forkEnv, which config-sync builds by spreading the
  // operator's process.env. Model exactly that: inherited keys, nothing invented.
  return buildGatewayRuntimeEnv({ PATH: '/usr/bin', ...operatorEnv }, { existsSync: () => false });
}

describe('FP-P0-03 launch contract matrix', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const managedKeys = [VTOKEN_ASSEMBLY_ENV, ENHANCEMENT_KILL_ENV];

  beforeEach(() => {
    for (const key of managedKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of managedKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('covers at least the seven required classes', () => {
    expect(LAUNCH_CONTRACT_MATRIX.length).toBeGreaterThanOrEqual(7);
    const ids = LAUNCH_CONTRACT_MATRIX.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(LAUNCH_CONTRACT_MATRIX.map((row) => [row.id, row] as const))(
    'row %s',
    (_id, testCase) => {
      it('Electron launch layer produces the expected child env', async () => {
        const env = await buildChildEnv(testCase.operatorEnv);
        if (testCase.expectChildEnv.present) {
          expect(env[VTOKEN_ASSEMBLY_ENV]).toBe(testCase.expectChildEnv.value);
        } else {
          expect(VTOKEN_ASSEMBLY_ENV in env).toBe(false);
        }
      });

      it('runtime resolver reaches the expected verdict', async () => {
        // Apply the operator env to this process so the resolvers, which read
        // process.env by default, see exactly what the child would see.
        const childEnv = await buildChildEnv(testCase.operatorEnv);
        for (const key of managedKeys) {
          if (key in childEnv && childEnv[key] !== undefined) {
            process.env[key] = childEnv[key] as string;
          } else {
            delete process.env[key];
          }
        }

        const { resolveVtokenAssemblyConfig } = await import(
          '../../openclaw_runtime/src/context-engine/chat-turn-vtoken-injection'
        );
        const { isContextEnhancementKillSwitchEngaged } = await import(
          '../../openclaw_runtime/src/context-engine/enhancement-kill-switch'
        );

        const cfg = configFor(testCase);
        expect(isContextEnhancementKillSwitchEngaged(cfg)).toBe(
          testCase.expectResolved.killSwitchEngaged,
        );
        expect(resolveVtokenAssemblyConfig(cfg).enabled).toBe(
          testCase.expectResolved.vtokenAssemblyEnabled,
        );
      });
    },
  );

  it('every covered md row still exists and has at least one fixture case', () => {
    const md = readFileSync(MATRIX_MD, 'utf-8');
    for (const row of MD_ROWS_COVERED_BY_LAUNCH_MATRIX) {
      expect(md, `md row missing: ${row}`).toContain(`**${row}**`);
      const cases = LAUNCH_CONTRACT_MATRIX.filter((c) => c.mdRows.includes(row));
      expect(cases.length, `no fixture case covers md row: ${row}`).toBeGreaterThan(0);
    }
  });

  it('md still declares VToken assembly as opt-in false (no silent default flip)', () => {
    const md = readFileSync(MATRIX_MD, 'utf-8');
    const line = md
      .split('\n')
      .find((candidate) => candidate.includes('**VToken assembly**'));
    expect(line).toBeDefined();
    expect(line).toContain('**false** (opt-in)');
  });

  it('every fixture case references a md row that the fixture claims to cover', () => {
    for (const testCase of LAUNCH_CONTRACT_MATRIX) {
      expect(testCase.mdRows.length, `case ${testCase.id} has no mdRows`).toBeGreaterThan(0);
      for (const row of testCase.mdRows) {
        expect(
          MD_ROWS_COVERED_BY_LAUNCH_MATRIX as readonly string[],
          `case ${testCase.id} references uncovered md row ${row}`,
        ).toContain(row);
      }
    }
  });
});
