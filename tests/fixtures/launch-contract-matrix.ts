/**
 * FP-P0-03: machine-readable launch/kill contract matrix.
 *
 * `docs/dev/default-config-matrix.md` is the SoT for *product defaults* but its
 * table does not encode the launch-layer × resolver cross-product (unset vs
 * explicit-on vs explicit-kill × config opt-in × Settings). This fixture encodes
 * that cross-product; `tests/unit/default-config-matrix.test.ts` asserts (a) every
 * row here holds against both the Electron launch layer and the runtime resolver,
 * and (b) every VToken/kill-switch row in the md has a case here, so a new md row
 * cannot be added without a test.
 *
 * Do not "fix" a failing row by editing it. If implementation and md disagree, the
 * md wins and the implementation changes (FP-P0-03 hard lock).
 */

export const VTOKEN_ASSEMBLY_ENV = 'VERSE_VTOKEN_ASSEMBLY_ENABLED';
export const ENHANCEMENT_KILL_ENV = 'VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH';

export type LaunchContractCase = {
  /** Stable id used in test names and in the md cross-reference check. */
  id: string;
  /** Which md matrix row(s) this case exercises. */
  mdRows: string[];
  /** Env the operator's shell exports before Electron launches the child. */
  operatorEnv: Record<string, string>;
  /** openclaw config the child reads (undefined = no config file / no opt-in). */
  config?: Record<string, unknown>;
  /**
   * Settings-driven opt-in intent. Today VToken has no Settings switch
   * (FP-P4-03), so this only documents intent and must not fabricate one.
   */
  settingsOptIn?: boolean;
  /** Expected value of the assembly env in the spawned child env. */
  expectChildEnv: { present: boolean; value?: string };
  /** Expected resolver verdict inside the child. */
  expectResolved: { vtokenAssemblyEnabled: boolean; killSwitchEngaged: boolean };
  /** Why this row is what it is — read by a human reviewing the gate. */
  rationale: string;
};

export const LAUNCH_CONTRACT_MATRIX: readonly LaunchContractCase[] = [
  {
    id: 'default-no-optin',
    mdRows: ['VToken assembly'],
    operatorEnv: {},
    expectChildEnv: { present: false },
    expectResolved: { vtokenAssemblyEnabled: false, killSwitchEngaged: false },
    rationale:
      'Clean install: launch layer injects nothing, resolver reads unset as the documented "false (opt-in)" default.',
  },
  {
    id: 'env-optin-canary',
    mdRows: ['VToken assembly'],
    operatorEnv: { [VTOKEN_ASSEMBLY_ENV]: '1' },
    expectChildEnv: { present: true, value: '1' },
    expectResolved: { vtokenAssemblyEnabled: true, killSwitchEngaged: false },
    rationale: 'Explicit env canary path from the md "How to enable" column.',
  },
  {
    id: 'config-optin',
    mdRows: ['VToken assembly'],
    operatorEnv: {},
    config: { runtime: { vtoken: { assembly: { enabled: true } } } },
    expectChildEnv: { present: false },
    expectResolved: { vtokenAssemblyEnabled: true, killSwitchEngaged: false },
    rationale:
      'The md offers config opt-in as an independent channel; it only works because the launch layer leaves the env unset (option A of FP-P0-01).',
  },
  {
    id: 'env-kill-beats-config-optin',
    mdRows: ['VToken assembly'],
    operatorEnv: { [VTOKEN_ASSEMBLY_ENV]: '0' },
    config: { runtime: { vtoken: { assembly: { enabled: true } } } },
    expectChildEnv: { present: true, value: '0' },
    expectResolved: { vtokenAssemblyEnabled: false, killSwitchEngaged: false },
    rationale: 'md "Instant kill" column: env=0 outranks every enable source.',
  },
  {
    id: 'enhancement-kill-beats-config-optin',
    mdRows: ['VToken assembly', 'Context enhancement kill switch'],
    operatorEnv: { [ENHANCEMENT_KILL_ENV]: '1' },
    config: { runtime: { vtoken: { assembly: { enabled: true } } } },
    expectChildEnv: { present: false },
    expectResolved: { vtokenAssemblyEnabled: false, killSwitchEngaged: true },
    rationale: 'The master enhancement kill switch also cuts VToken.',
  },
  {
    id: 'config-kill-switch-beats-config-optin',
    mdRows: ['VToken assembly', 'Context enhancement kill switch'],
    operatorEnv: {},
    config: {
      runtime: {
        vtoken: { assembly: { enabled: true } },
        contextEnhancement: { killSwitch: true },
      },
    },
    expectChildEnv: { present: false },
    expectResolved: { vtokenAssemblyEnabled: false, killSwitchEngaged: true },
    rationale:
      'FP-P0-02: the config form of the kill switch must be a real switch, not an env-only one.',
  },
  {
    id: 'dual-kill',
    mdRows: ['VToken assembly', 'Context enhancement kill switch'],
    operatorEnv: { [VTOKEN_ASSEMBLY_ENV]: '0', [ENHANCEMENT_KILL_ENV]: '1' },
    config: { runtime: { vtoken: { assembly: { enabled: true } } } },
    expectChildEnv: { present: true, value: '0' },
    expectResolved: { vtokenAssemblyEnabled: false, killSwitchEngaged: true },
    rationale: 'Both kills at once must not double-negate into an enable.',
  },
  {
    id: 'settings-on-plus-env-kill',
    mdRows: ['VToken assembly'],
    operatorEnv: { [VTOKEN_ASSEMBLY_ENV]: '0' },
    config: { runtime: { vtoken: { assembly: { enabled: true } } } },
    settingsOptIn: true,
    expectChildEnv: { present: true, value: '0' },
    expectResolved: { vtokenAssemblyEnabled: false, killSwitchEngaged: false },
    rationale:
      'Operator turned it on at the highest layer available today (config, since no Settings switch exists yet) while the env kill is set: kill still wins.',
  },
  {
    id: 'config-unparseable-fail-closed',
    mdRows: ['VToken assembly', 'Context enhancement kill switch'],
    operatorEnv: {},
    // Sentinel: the test substitutes an object whose getter throws.
    config: { __unparseable__: true },
    expectChildEnv: { present: false },
    expectResolved: { vtokenAssemblyEnabled: false, killSwitchEngaged: true },
    rationale:
      'Unreadable config must fail closed (enhancements cut), never silently resolve to "no kill".',
  },
] as const;

/** md matrix rows whose launch-layer cross-product this fixture covers in depth. */
export const MD_ROWS_COVERED_BY_LAUNCH_MATRIX = [
  'VToken assembly',
  'Context enhancement kill switch',
] as const;

/**
 * Every surface row in `docs/dev/default-config-matrix.md`, with the product default
 * the md declares. `tests/unit/default-config-matrix.test.ts` iterates this list and
 * requires a registered default-assertion for each entry, so adding an md row without
 * a test fails the suite (AC: "matrix 每一行都要有断言，缺行即失败").
 *
 * `mdLabel` must match the bolded surface name in the md table verbatim.
 */
export type MdMatrixRow = {
  mdLabel: string;
  /**
   * FP-P0-07: the VERBATIM "Product default" cell text from the md table row.
   * tests/unit/default-config-matrix.test.ts compares this byte-for-byte with the
   * parsed md cell, so editing the md cell without editing this fixture (or vice
   * versa) fails CI. The md is the SoT: never edit the md default to make this pass.
   */
  mdDefaultCell: string;
  /** The product default the md declares, normalized. */
  declaredDefault: 'true' | 'false' | 'off' | 'deny' | 'auto';
  /** Which assertion group in the test owns this row. */
  assertedBy: string;
};

export const MD_MATRIX_ROWS: readonly MdMatrixRow[] = [
  {
    mdLabel: 'VToken assembly',
    mdDefaultCell: '**false** (opt-in)',
    declaredDefault: 'false',
    assertedBy: 'vtoken-assembly-default',
  },
  {
    mdLabel: 'VToken bridge',
    mdDefaultCell: '**false**',
    declaredDefault: 'false',
    assertedBy: 'vtoken-bridge-default',
  },
  {
    mdLabel: 'Workspace Context',
    mdDefaultCell: '**true**',
    declaredDefault: 'true',
    assertedBy: 'context-block-defaults',
  },
  {
    mdLabel: 'working-memory',
    mdDefaultCell: '**true**',
    declaredDefault: 'true',
    assertedBy: 'context-block-defaults',
  },
  {
    mdLabel: 'tool-registry',
    mdDefaultCell: '**true**',
    declaredDefault: 'true',
    assertedBy: 'context-block-defaults',
  },
  {
    mdLabel: 'Runtime Memory inject pilot',
    mdDefaultCell: '**false**',
    declaredDefault: 'false',
    assertedBy: 'memory-inject-pilot-default',
  },
  {
    mdLabel: 'Runtime Memory shadow/provider/persist',
    mdDefaultCell: '**false**',
    declaredDefault: 'false',
    assertedBy: 'memory-shadow-provider-persist-default',
  },
  {
    mdLabel: 'SEKB master',
    mdDefaultCell: '**false**',
    declaredDefault: 'false',
    assertedBy: 'sekb-master-default',
  },
  {
    mdLabel: 'SEKB auto writeback',
    mdDefaultCell: '**off**',
    declaredDefault: 'off',
    assertedBy: 'sekb-auto-writeback-off',
  },
  {
    mdLabel: 'SEKB shadow evaluation',
    mdDefaultCell: '**false**',
    declaredDefault: 'false',
    assertedBy: 'sekb-shadow-evaluation-default',
  },
  {
    mdLabel: 'Browser private network',
    mdDefaultCell: '**false** (deny)',
    declaredDefault: 'deny',
    assertedBy: 'browser-private-network-default',
  },
  {
    mdLabel: 'Context enhancement kill switch',
    mdDefaultCell: '**false**',
    declaredDefault: 'false',
    assertedBy: 'enhancement-kill-switch-default',
  },
  {
    mdLabel: 'Coding auto verify',
    mdDefaultCell: '**auto** (detect runner, else skip)',
    declaredDefault: 'auto',
    assertedBy: 'coding-auto-verify-default',
  },
] as const;
