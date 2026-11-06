// @vitest-environment node

import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  collectContractIssues,
  inlineModuleFacadeAliases,
  parseContractActions,
  parseContractAliasMembers,
  parseContractTypeImports,
  parseFacadeActions,
  parseIpcMainHandleSites,
  parsePreloadAllowlist,
  parseRegistryScenarioIds,
} from '../../scripts/contract-check.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_DIR = 'tests/fixtures/contract-check';
const execFileAsync = promisify(execFile);

const contractText = `
import type { ChangeContextApiContract } from '../types/change-context';
export type HostApiContract = {
  agentDev: {
    status: () => AgentDevStatusResult;
    seedState: (payload?: AgentDevSeedStatePayload) => AgentDevSeedStateResult;
  };
  changeContext: ChangeContextApiContract;
};
`;

const changeContextTypeText = `
export type ChangeContextApiContract = {
  getProjection: (payload: ChangeContextProjectionPayload) => ChangeContextProjectionResult;
  pullChanges: (
    payload: ChangeContextPullChangesPayload,
  ) => ChangeContextPullChangesResult;
};
`;

const hostApiText = `
export const hostApi = {
  agentDev: {
    status: () => invokeHost('agentDev', 'status'),
    seedState: (input) => invokeHost('agentDev', 'seedState', input),
  },
  changeContext: {
    getProjection: (
      input: ChangeContextProjectionPayload,
    ): Promise<ChangeContextProjectionResult> => (
      invokeHost('changeContext', 'getProjection', input)
    ),
    pullChanges: (input) => invokeHost('changeContext', 'pullChanges', input),
  },
};
`;

const ipcHandlersText = `
  const services: HostServiceRegistry = {
    agentDev: createAgentDevApi({ gatewayManager }),
    changeContext: createChangeContextApi({ gatewayManager }),
  };
`;

const agentDevApiText = `
import { isAgentDevScenarioId } from '@shared/agent-dev/scenarios';
export function createAgentDevApi() {
  return {
    status: () => ({}),
    seedState: async (payload) => {
      assertAgentDevSeedStatePayload(payload);
      assertAgentDevMockReplayConfig(payload);
      assertAgentDevFeatureFlagsPayload(payload);
      assertAgentDevRecordScenarioPayload(payload);
    },
  };
}
`;

const scenarioRegistryText = `
export const AGENT_DEV_SCENARIOS = [
  { id: 'chat-empty', route: '/', description: '', seed: {} },
  { id: 'chat-streaming', route: '/', description: '', seed: {} },
  { id: 'models-heavy-usage', route: '/', description: '', seed: {} },
  { id: 'settings-provider-error', route: '/', description: '', seed: {} },
  { id: 'doctor-failed', route: '/', description: '', seed: {} },
  { id: 'gateway-connecting', route: '/', description: '', seed: {} },
  { id: 'knowledge-drafts', route: '/', description: '', seed: {} },
  { id: 'observability-trace-errors', route: '/', description: '', seed: {} },
  { id: 'transport-fallback-chain', route: '/', description: '', seed: {} },
  { id: 'skill-execution-timeout', route: '/', description: '', seed: {} },
  { id: 'multi-agent-handoff', route: '/', description: '', seed: {} },
  { id: 'knowledge-conflict-merge', route: '/', description: '', seed: {} },
  { id: 'channel-reconnect-storm', route: '/', description: '', seed: {} },
  { id: 'clawgraph-dag-cycle', route: '/', description: '', seed: {} },
] as const;
`;

const HANDLERS_FILE = 'electron/main/ipc-handlers.ts';
const HOST_INVOKE_FILE = 'electron/main/ipc/host-invoke.ts';
const PRELOAD_FILE = 'electron/preload/index.ts';

const preloadText = [
  '      const validChannels = [',
  "        'agentDev:ping',",
  "        'legacy:orphan',",
  '      ];',
].join('\n');

function flatIpcRegistry(overrides = {}) {
  return {
    schema: 'ContractCheckFlatIpcAdjudication/v1',
    handlersFile: HANDLERS_FILE,
    allowlistFile: PRELOAD_FILE,
    hostInvoke: { file: HOST_INVOKE_FILE, channel: 'host:invoke' },
    channels: [
      {
        channel: 'agentDev:ping',
        typedModule: 'agentDev',
        typedAction: 'status',
        preload: 'allowlisted',
        disposition: 'freeze',
        reason: 'E2E mock seam.',
        removalPlan: 'Bridge the seam onto host:invoke.',
      },
      {
        channel: 'agentDev:hidden',
        typedModule: 'agentDev',
        typedAction: null,
        preload: 'unreachable',
        disposition: 'retire',
        reason: 'No consumer.',
      },
    ],
    danglingAllowlistEntries: [
      { channel: 'legacy:orphan', disposition: 'retire', reason: 'No handler anywhere.' },
    ],
    ...overrides,
  };
}

function ipcMainHandleSites() {
  return [
    { file: HOST_INVOKE_FILE, line: 1, channel: 'host:invoke', expression: "'host:invoke'" },
    { file: HANDLERS_FILE, line: 10, channel: 'agentDev:ping', expression: "'agentDev:ping'" },
    { file: HANDLERS_FILE, line: 20, channel: 'agentDev:hidden', expression: "'agentDev:hidden'" },
  ];
}

function baseInput(overrides = {}) {
  return {
    contractText,
    hostApiText,
    ipcHandlersText,
    agentDevApiText,
    agentDevSchemaText: 'AGENT_DEV_SCENARIO_IDS',
    rendererAgentDevText: '@shared/agent-dev/scenario-composer',
    workbenchText: 'shared/agent-dev/scenarios.ts',
    scenarioRegistryText,
    aliasTypeTexts: { 'shared/types/change-context.ts': changeContextTypeText },
    flatIpcRegistry: flatIpcRegistry(),
    ipcMainHandleSites: ipcMainHandleSites(),
    preloadText,
    ...overrides,
  };
}

function registryWithChannel(mutate: Record<string, unknown>) {
  const registry = flatIpcRegistry();
  registry.channels = registry.channels.map((entry) => (entry.channel === 'agentDev:ping' ? { ...entry, ...mutate } : entry));
  return registry;
}

async function runGate(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['scripts/contract-check.mjs', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('contract check', () => {
  it('parses contract, facade, and scenario registry entries', () => {
    expect([...parseContractActions(contractText).get('agentDev')!]).toEqual(['status', 'seedState']);
    expect([...parseFacadeActions(hostApiText).get('agentDev')!]).toEqual(['status', 'seedState']);
    expect(parseRegistryScenarioIds(scenarioRegistryText)).toContain('doctor-failed');
  });

  it('inlines aliased module facades for contract parsing', () => {
    const aliasedHostApi = [
      'export const hostApi = {',
      '  knowledge: knowledgeHostApi,',
      '};',
    ].join('\n');
    const moduleFacades = {
      knowledgeHostApi: [
        'export const knowledgeHostApi = {',
        '  ...knowledgeRoutingApi,',
        '};',
      ].join('\n'),
      knowledgeRoutingApi: [
        'export const knowledgeRoutingApi = {',
        "  routeContext: (input) => invokeHost('knowledge', 'routeContext', input),",
        '};',
      ].join('\n'),
    };
    const inlined = inlineModuleFacadeAliases(aliasedHostApi, moduleFacades);

    expect([...parseFacadeActions(inlined).get('knowledge')!]).toEqual(['routeContext']);
  });

  it('passes representative aligned P0 inputs', () => {
    expect(collectContractIssues(baseInput())).toEqual([]);
  });

  it('reports readable drift for missing facade actions and registry ids', () => {
    const issues = collectContractIssues(baseInput({
      hostApiText: hostApiText.replace("    seedState: (input) => invokeHost('agentDev', 'seedState', input),\n", ''),
      scenarioRegistryText: scenarioRegistryText.replace("  { id: 'doctor-failed', route: '/', description: '', seed: {} },\n", ''),
    }));

    expect(issues).toEqual(expect.arrayContaining([
      "src/lib/host-api.ts: missing hostApi.agentDev.seedState facade",
      "shared/agent-dev/scenarios.ts: missing required scenario 'doctor-failed'",
    ]));
  });
});

describe('contract check: alias contract members', () => {
  it('lists alias members and resolves their relative type imports', () => {
    expect([...parseContractAliasMembers(contractText)]).toEqual([['changeContext', 'ChangeContextApiContract']]);
    expect(parseContractTypeImports(contractText).get('ChangeContextApiContract')).toBe('../types/change-context');
  });

  it('resolves alias members to their actions when the defining type text is supplied', () => {
    const modules = parseContractActions(contractText, { x: changeContextTypeText });
    expect([...modules.get('changeContext')!]).toEqual(['getProjection', 'pullChanges']);
  });

  it('fails closed when an alias member cannot be resolved', () => {
    const issues = collectContractIssues(baseInput({ aliasTypeTexts: {} }));
    expect(issues).toEqual([
      "shared/host-api/contract.ts: [host-api/unresolved-alias-member] HostApiContract.changeContext aliases type 'ChangeContextApiContract', which could not be resolved to an object type for reconciliation",
    ]);
  });

  it('reconciles alias member actions against the facade and invokeHost', () => {
    const issues = collectContractIssues(baseInput({
      hostApiText: hostApiText.replace("    pullChanges: (input) => invokeHost('changeContext', 'pullChanges', input),\n", ''),
    }));
    expect(issues).toEqual(['src/lib/host-api.ts: missing hostApi.changeContext.pullChanges facade']);
  });
});

describe('contract check: flat IPC admission surface', () => {
  it('finds a namespace registration after an interpolated template', () => {
    const text = [
      'const example = `a${1}b`;',
      "const owner = require('electron');",
      "owner['ipcMain']['handle']('a:one', () => 1);",
    ].join('\n');
    expect(parseIpcMainHandleSites(text, 'f.cjs')).toEqual([
      { file: 'f.cjs', line: 3, channel: 'a:one', expression: "'a:one'" },
    ]);
  });

  it('ignores comments, strings, unrelated handles and shadowed IPC objects', () => {
    const text = [
      "import { ipcMain } from 'electron';",
      "// ipcMain.handle('comment', () => 1);",
      "const example = \"ipcMain['handle']('string', () => 1)\";",
      "function shadow(ipcMain: { handle: (name: string) => void }) { ipcMain.handle('local'); }",
      "const local = { handle: (name: string) => name }; local.handle('local');",
    ].join('\n');
    expect(parseIpcMainHandleSites(text, 'f.ts')).toEqual([]);
  });

  it('resolves scoped aliases and parenthesized/type-wrapped IPC receivers', () => {
    const text = [
      "import { ipcMain as owner } from 'electron';",
      "const request = (owner as unknown as typeof owner)['handle'];",
      "request('a:one', () => 1);",
      "function shadow(request: (name: string) => void) { request('local'); }",
    ].join('\n');
    expect(parseIpcMainHandleSites(text, 'f.ts')).toEqual([
      { file: 'f.ts', line: 3, channel: 'a:one', expression: "'a:one'" },
    ]);
  });

  it.each([
    "register('payload');",
    "register.call(ipcMain, 'payload');",
    "register.apply(ipcMain, ['payload']);",
    "const alias = register; alias.bind(null, 'payload')();",
  ])('keeps the original bound channel for %s', (invocation) => {
    const text = [
      "import { ipcMain } from 'electron';",
      "const register = ipcMain.handle.bind(ipcMain, 'a:bound');",
      invocation,
    ].join('\n');
    expect(parseIpcMainHandleSites(text, 'f.ts')).toEqual([
      { file: 'f.ts', line: 3, channel: 'a:bound', expression: "'a:bound'" },
    ]);
  });

  it('retains nonliteral bound channels and handleOnce identity', () => {
    const text = [
      "import { ipcMain } from 'electron';",
      'const register = ipcMain.handleOnce.bind(ipcMain, channel);',
      "register('host:invoke');",
    ].join('\n');
    expect(parseIpcMainHandleSites(text, 'f.ts')).toEqual([
      { file: 'f.ts', line: 3, channel: null, expression: 'channel', method: 'handleOnce' },
    ]);
  });

  it('does not treat dynamic or default bindings from ordinary objects as IPC', () => {
    const text = [
      "import { ipcMain as realIpcMain } from 'electron';",
      'const local = { handle: () => undefined };',
      'const { [method]: request = local.handle.bind(local) } = local;',
      "request('ordinary');",
      'const { ipcMain: { handle: nested } = local } = {};',
      "nested('ordinary');",
      'const { ipcMain = local } = {};',
      "ipcMain.handle('ordinary');",
      'function shadow(realIpcMain) {',
      '  const { [method]: request } = realIpcMain;',
      "  request('ordinary');",
      '}',
    ].join('\n');
    expect(parseIpcMainHandleSites(text, 'f.ts')).toEqual([]);
  });

  it('enumerates ipcMain.handle sites including multi-line and non-literal forms', () => {
    const text = [
      "ipcMain.handle('a:one', () => 1);",
      'ipcMain.handle(',
      "  'b:two',",
      '  async () => 2,',
      ');',
      'ipcMain.handle(dynamicChannel, () => 3);',
    ].join('\n');
    expect(parseIpcMainHandleSites(text, 'f.ts')).toEqual([
      { file: 'f.ts', line: 1, channel: 'a:one', expression: "'a:one'" },
      { file: 'f.ts', line: 2, channel: 'b:two', expression: "'b:two'" },
      { file: 'f.ts', line: 6, channel: null, expression: 'dynamicChannel' },
    ]);
  });

  it('parses the preload allowlist and fails closed when it is missing', () => {
    expect(parsePreloadAllowlist(preloadText)).toEqual(['agentDev:ping', 'legacy:orphan']);
    expect(parsePreloadAllowlist('')).toBeNull();
    expect(collectContractIssues(baseInput({ preloadText: '' }))).toEqual([
      'electron/preload/index.ts: [flat-ipc/allowlist-missing] could not locate the validChannels allowlist',
    ]);
  });

  it('enforces the final zero-handler, host-invoke-only preload invariant', () => {
    const retiredRegistry = flatIpcRegistry({
      channels: flatIpcRegistry().channels.map((entry) => ({
        ...entry,
        disposition: 'retired',
        retirement: { status: 'retired', commit: '1234567', batch: 9, retiredOn: '2026-11-02' },
      })),
      danglingAllowlistEntries: [],
    });
    const hostOnlyPreload = "const verseClawAPI = { hostInvoke: (request: HostRequest) => ipcRenderer.invoke('host:invoke', request) };\n";
    const hostOnlySites = [{ file: HOST_INVOKE_FILE, line: 1, channel: 'host:invoke', expression: "'host:invoke'" }];

    expect(collectContractIssues(baseInput({
      flatIpcRegistry: retiredRegistry,
      ipcMainHandleSites: hostOnlySites,
      preloadText: hostOnlyPreload,
    }))).toEqual([]);

    expect(collectContractIssues(baseInput({
      flatIpcRegistry: retiredRegistry,
      ipcMainHandleSites: [...hostOnlySites, { file: HANDLERS_FILE, line: 9, channel: 'agentDev:ping', expression: "'agentDev:ping'" }],
      preloadText: hostOnlyPreload,
    }))).toEqual([
      "electron/main/ipc-handlers.ts:9: [flat-ipc/retired-channel-live] ipcMain.handle('agentDev:ping') is registered but the registry marks it retired",
    ]);

    expect(collectContractIssues(baseInput({
      flatIpcRegistry: retiredRegistry,
      ipcMainHandleSites: hostOnlySites,
      preloadText: hostOnlyPreload + "export const leak = () => ipcRenderer.invoke('gateway:status');\n",
    }))).toEqual([
      "electron/preload/index.ts:2: [flat-ipc/preload-direct-invoke] 'gateway:status' is invoked directly by the preload; only 'host:invoke' may use ipcRenderer.invoke",
    ]);
  });

  it('fails closed when the registry or the site enumeration is absent', () => {
    expect(collectContractIssues(baseInput({ flatIpcRegistry: undefined }))).toEqual([
      'scripts/contract-check-flat-ipc.json: [flat-ipc/registry-missing] flat IPC adjudication registry was not loaded',
    ]);
    expect(collectContractIssues(baseInput({ ipcMainHandleSites: undefined }))).toEqual([
      'electron/: [flat-ipc/sites-missing] ipcMain.handle sites were not enumerated',
    ]);
  });

  it('rejects an unregistered flat channel with its file and line', () => {
    const sites = [...ipcMainHandleSites(), { file: HANDLERS_FILE, line: 99, channel: 'rogue:thing', expression: "'rogue:thing'" }];
    expect(collectContractIssues(baseInput({ ipcMainHandleSites: sites }))).toEqual([
      "electron/main/ipc-handlers.ts:99: [flat-ipc/unregistered-channel] ipcMain.handle('rogue:thing') is not adjudicated in scripts/contract-check-flat-ipc.json",
    ]);
  });

  it('rejects a stale registry entry whose handler is gone', () => {
    const sites = ipcMainHandleSites().filter((site) => site.channel !== 'agentDev:hidden');
    expect(collectContractIssues(baseInput({ ipcMainHandleSites: sites }))).toEqual([
      "scripts/contract-check-flat-ipc.json: [flat-ipc/stale-registry-entry] 'agentDev:hidden' is adjudicated but has no ipcMain.handle in electron/main/ipc-handlers.ts",
    ]);
  });

  it('rejects channels that bypass HostApiRegistry or use non-literal names', () => {
    const sites = [
      ...ipcMainHandleSites(),
      { file: 'electron/main/other.ts', line: 3, channel: 'agentDev:side', expression: "'agentDev:side'" },
      { file: HANDLERS_FILE, line: 4, channel: null, expression: 'computed' },
    ];
    expect(collectContractIssues(baseInput({ ipcMainHandleSites: sites }))).toEqual([
      "electron/main/other.ts:3: [flat-ipc/bypass-registry] ipcMain.handle('agentDev:side') is registered outside electron/main/ipc-handlers.ts and bypasses HostApiRegistry",
      'electron/main/ipc-handlers.ts:4: [flat-ipc/non-literal-channel] ipcMain.handle channel must be a string literal so it can be enumerated (got computed)',
    ]);
  });

  it('requires the single typed host:invoke entry to exist', () => {
    const sites = ipcMainHandleSites().filter((site) => site.channel !== 'host:invoke');
    expect(collectContractIssues(baseInput({ ipcMainHandleSites: sites }))).toEqual([
      "electron/main/ipc/host-invoke.ts: [flat-ipc/typed-entry-missing] expected the single typed entry ipcMain.handle('host:invoke')",
    ]);
  });

  it('requires every dual-entry channel to be acknowledged with a typed module and a reason', () => {
    expect(collectContractIssues(baseInput({ flatIpcRegistry: registryWithChannel({ reason: ' ' }) }))).toEqual([
      "scripts/contract-check-flat-ipc.json: [flat-ipc/dual-entry-unacknowledged] 'agentDev:ping' shares domain 'agentDev' with the typed Host API but has no reason for the compatibility exception",
    ]);
    expect(collectContractIssues(baseInput({ flatIpcRegistry: registryWithChannel({ typedModule: 'settings' }) }))).toEqual([
      "scripts/contract-check-flat-ipc.json: [flat-ipc/dual-entry-unacknowledged] 'agentDev:ping' shares domain 'agentDev' with the typed Host API but the registry declares typedModule \"settings\"",
    ]);
  });

  it('rejects flat channels outside any typed domain and unknown typed actions', () => {
    const registry = flatIpcRegistry();
    registry.channels.push({ channel: 'zzz:thing', typedModule: 'zzz', typedAction: null, preload: 'allowlisted', disposition: 'retire', reason: 'x' });
    const sites = [...ipcMainHandleSites(), { file: HANDLERS_FILE, line: 30, channel: 'zzz:thing', expression: "'zzz:thing'" }];
    const issues = collectContractIssues(baseInput({
      flatIpcRegistry: registry,
      ipcMainHandleSites: sites,
      preloadText: preloadText.replace("        'legacy:orphan',", "        'legacy:orphan',\n        'zzz:thing',"),
    }));
    expect(issues).toEqual([
      "scripts/contract-check-flat-ipc.json: [flat-ipc/no-typed-domain] 'zzz:thing' prefix 'zzz' has no typed Host API module (exact or plural); a flat channel may only exist inside a typed domain",
    ]);

    expect(collectContractIssues(baseInput({ flatIpcRegistry: registryWithChannel({ typedAction: 'nope' }) }))).toEqual([
      "scripts/contract-check-flat-ipc.json: [flat-ipc/typed-action-missing] 'agentDev:ping' maps to agentDev.nope, which is not declared in HostApiContract",
    ]);
  });

  it('requires migrate and freeze dispositions to carry a removal plan and rejects unknown dispositions', () => {
    expect(collectContractIssues(baseInput({ flatIpcRegistry: registryWithChannel({ removalPlan: '' }) }))).toEqual([
      "scripts/contract-check-flat-ipc.json: [flat-ipc/removal-plan-missing] 'agentDev:ping' is freeze but declares no removalPlan",
    ]);
    expect(collectContractIssues(baseInput({ flatIpcRegistry: registryWithChannel({ disposition: 'keep' }) }))).toEqual([
      "scripts/contract-check-flat-ipc.json: [flat-ipc/invalid-disposition] 'agentDev:ping' disposition must be retire|migrate|freeze|retired (got \"keep\")",
    ]);
  });

  it('reconciles the preload allowlist in both directions', () => {
    expect(collectContractIssues(baseInput({
      preloadText: preloadText.replace("        'legacy:orphan',", "        'legacy:orphan',\n        'rogue:dangling',"),
    }))).toEqual([
      "electron/preload/index.ts: [flat-ipc/allowlist-dangling] 'rogue:dangling' is in validChannels but has no ipcMain.handle and is not adjudicated as dangling in scripts/contract-check-flat-ipc.json",
    ]);
    expect(collectContractIssues(baseInput({
      preloadText: preloadText.replace("        'agentDev:ping',\n", ''),
    }))).toEqual([
      "electron/preload/index.ts: [flat-ipc/preload-mismatch] 'agentDev:ping' is unreachable in validChannels but the registry declares allowlisted",
    ]);
    expect(collectContractIssues(baseInput({
      preloadText: preloadText.replace("        'legacy:orphan',\n", ''),
    }))).toEqual([
      "scripts/contract-check-flat-ipc.json: [flat-ipc/stale-dangling-entry] 'legacy:orphan' is adjudicated as dangling but is no longer in validChannels",
    ]);
  });
});

describe('contract check: real gate entry (node scripts/contract-check.mjs)', () => {
  const fixtures = readdirSync(`${ROOT}/${FIXTURE_DIR}`).filter((name) => name.endsWith('.json')).sort();
  const positiveFixtures = fixtures.filter((name) => JSON.parse(readFileSync(`${ROOT}/${FIXTURE_DIR}/${name}`, 'utf8')).expectCode === 0);
  const negativeFixtures = fixtures.filter((name) => !positiveFixtures.includes(name));

  it('passes on the current repository without fixtures', async () => {
    const result = await runGate([]);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('Contract check passed.');
    expect(result.code).toBe(0);
  }, 30_000);

  it('ships every negative class as a checked-in fixture', () => {
    const rules = negativeFixtures.map((name) => JSON.parse(readFileSync(`${ROOT}/${FIXTURE_DIR}/${name}`, 'utf8')).rule);
    expect(rules).toEqual(expect.arrayContaining([
      'flat-ipc/unregistered-channel',
      'flat-ipc/dual-entry-unacknowledged',
      'flat-ipc/bypass-registry',
      'flat-ipc/allowlist-dangling',
      'flat-ipc/preload-mismatch',
      'flat-ipc/preload-direct-invoke',
      'flat-ipc/retired-channel-live',
      'flat-ipc/non-static-method',
      'flat-ipc/typed-entry-duplicate',
      'host-api/unresolved-alias-member',
      'host-api/facade-missing-action',
    ]));
  });

  it.each(negativeFixtures)('rejects fixture %s through the real entry with a single locatable diagnostic', async (name) => {
    const fixture = JSON.parse(readFileSync(`${ROOT}/${FIXTURE_DIR}/${name}`, 'utf8'));
    const result = await runGate(['--fixture', `${FIXTURE_DIR}/${name}`]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Contract check fixtures applied: ${fixture.id}`);
    expect(result.stderr).toContain('Contract check failed:');
    const issues = result.stderr.split(/\r?\n/).filter((line) => line.startsWith('- '));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(fixture.expect);
  }, 30_000);

  it.each(positiveFixtures)('accepts fixture %s through the real entry without diagnostics', async (name) => {
    const fixture = JSON.parse(readFileSync(`${ROOT}/${FIXTURE_DIR}/${name}`, 'utf8'));
    const result = await runGate(['--fixture', `${FIXTURE_DIR}/${name}`]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('Contract check passed.');
    expect(result.stderr.trim()).toBe(`Contract check fixtures applied: ${fixture.id}`);
  }, 30_000);

  it.each(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'])('keeps virtual %s production probes off disk', (extension) => {
    expect(() => readFileSync(`${ROOT}/electron/contract-check-probe.${extension}`)).toThrow();
  });

  it('distinguishes a broken fixture (exit 2) from a gate failure (exit 1)', async () => {
    const result = await runGate(['--fixture', `${FIXTURE_DIR}/does-not-exist.json`]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Contract check fixture error:');
  }, 30_000);
});
