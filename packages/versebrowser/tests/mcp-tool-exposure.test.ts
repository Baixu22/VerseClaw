/**
 * TF-0064 — MCP tool exposure.
 *
 * The advertised `tools/list` must be a promise the server can keep: every
 * listed tool has a dispatcher handler AND is served by the active driver.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { okResult } from '../src/contracts/index';
import { resolveMcpPolicy, type McpPolicy } from '../src/mcp/capability-policy';
import {
  TOOL_CATALOG,
  createMcpServer,
  listExposedTools,
  type McpServerDeps,
} from '../src/mcp/server';
import {
  TOOL_AVAILABILITY,
  exposureReason,
  filterExposedTools,
  isToolExposed,
} from '../src/mcp/tool-availability';
import {
  ASSUMED_FULL_DRIVER_PROFILE,
  NONE_DRIVER_PROFILE,
  profileForDriver,
  type DriverProfile,
} from '../src/engine/driver-profile';
import { setWorkspaceRoot } from '../src/host/workspace-paths';
import { AgentBrowserFacade } from '../src/engine/facade';

// Keep evidence side effects (record_start / evidence_write) out of the repo.
const scratchRoot = mkdtempSync(join(tmpdir(), 'vb-mcp-exposure-'));
setWorkspaceRoot(scratchRoot);
afterAll(() => setWorkspaceRoot(undefined));

const ALL_GROUPS = 'core,debug,network,auth,authority,evidence';
const ALL_CAPS = [
  'browser.open',
  'browser.navigate',
  'browser.act',
  'browser.observe',
  'browser.close',
  'debug.console',
  'debug.explain',
  'debug.runtime',
  'network.read',
  'network.replay',
  'auth.vault',
  'authority.upgrade',
  'authority.revoke',
  'evidence.write',
  'evidence.read',
].join(',');

function permissivePolicy(): McpPolicy {
  return resolveMcpPolicy({ groups: ALL_GROUPS, caps: ALL_CAPS, env: {} });
}

type StubFacade = { facade: AgentBrowserFacade; calls: string[] };

/** Facade double: every method resolves ok and records its name. */
function stubFacade(profile: DriverProfile = ASSUMED_FULL_DRIVER_PROFILE): StubFacade {
  const calls: string[] = [];
  const target: Record<string, unknown> = { getDriverProfile: () => profile };
  const proxy = new Proxy(target, {
    get(inner, prop) {
      if (typeof prop !== 'string') return undefined;
      // Never look like a thenable: `ensureFacade` is async and resolves the
      // facade, so a function-valued `then` would deadlock the promise.
      if (prop === 'then') return undefined;
      if (prop in inner) return (inner as Record<string, unknown>)[prop];
      return async (...args: unknown[]) => {
        calls.push(prop);
        return okResult(`stub ${prop}`, { stub: true, args });
      };
    },
  }) as unknown as AgentBrowserFacade;
  return { facade: proxy, calls };
}

async function connect(deps: McpServerDeps): Promise<Client> {
  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'vb-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const CALL_ARGS = {
  sessionId: 's-1',
  error: 'TypeError: boom\n    at app.min.js:1:1',
  url: 'https://example.com',
  selector: '#go',
  text: 'x',
  target: 'full_access',
  confirmed: true,
  baseline: 'n-1',
  current: 'n-2',
  requestIds: ['n-1', 'n-2'],
  paths: ['window.__APP_CONFIG__'],
  dirName: 'exposure-test',
  packDir: scratchRoot,
};

function resultText(content: unknown): string {
  return JSON.stringify(content);
}

describe('mcp tool exposure (TF-0064)', () => {
  it('form overview requires observe permission and valid schema before dispatch', async () => {
    const stub = stubFacade(profileForDriver('upstream'));
    let allowed = true;
    const client = await connect({facade:stub.facade,getPolicy:()=>resolveMcpPolicy({groups:'core',caps:allowed?'browser.observe':'',env:{}})});
    expect((await client.listTools()).tools.map(tool=>tool.name)).toContain('vb_forms');
    const bad = await client.callTool({name:'vb_forms',arguments:{sessionId:'s',selector:42}});
    expect(resultText(bad.content)).toContain('E_ARG'); expect(stub.calls).toEqual([]);
    await client.callTool({name:'vb_forms',arguments:{sessionId:'s'}}); expect(stub.calls).toEqual(['readForms']);
    allowed = false;
    const denied = await client.callTool({name:'vb_forms',arguments:{sessionId:'s'}});
    expect(resultText(denied.content)).toContain('E_CAPABILITY_DENY'); expect(stub.calls).toEqual(['readForms']);
  });
  it('rejects new read options before calling an old host that ignores options', async () => {
    let calls = 0;
    const facade = new AgentBrowserFacade({ api: {
      takeSnapshot: async () => { calls++; return { success: true, snapshot: 'whole page' }; },
      extractPageText: async () => { calls++; return { success: true, text: '[]', truncated: false, usedFallback: false }; },
    } as never });
    expect((await facade.snapshot('s', { selector: '#region' })).ok).toBe(false);
    expect((await facade.snapshot('s', { paged: true })).ok).toBe(false);
    expect((await facade.extractPageText({ sessionId: 's', structured: true })).ok).toBe(false);
    expect(calls).toBe(0);
  });
  it('new actions validate arguments, dispatch once and respect per-call revocation', async () => {
    const stub = stubFacade(profileForDriver('upstream'));
    let allowed = true;
    const client = await connect({ facade: stub.facade, getPolicy: () => allowed ? permissivePolicy() : resolveMcpPolicy({ groups: 'core', caps: 'browser.observe', env: {} }) });
    const cases = [
      ['vb_select', 'selectOption', { selector: '#plan', label: 'Pro' }, { label: 42 }],
      ['vb_select_values', 'selectValues', { selector: '#tags', values: ['a'] }, { values: 'a' }],
      ['vb_check', 'setChecked', { selector: '#terms', checked: true }, { checked: 'true' }],
      ['vb_append', 'appendText', { selector: '#name', text: 'x' }, { text: 42 }],
      ['vb_pointer', 'pointer', { selector: '#menu', action: 'hover' }, { action: 'unknown' }],
      ['vb_drag', 'drag', { sourceSelector: '#a', targetSelector: '#b' }, { targetSelector: 42 }],
      ['vb_press', 'pressKey', { selector: '#name', key: 'Enter' }, { key: 42 }],
    ] as const;
    const listed = (await client.listTools()).tools.map(tool => tool.name);
    for (const [name, method, args, invalid] of cases) {
      expect(listed).toContain(name);
      allowed = true;
      const before = stub.calls.length;
      const bad = await client.callTool({ name, arguments: { sessionId: 's-1', ...args, ...invalid } });
      expect(resultText(bad.content)).toContain('E_ARG'); expect(stub.calls.length).toBe(before);
      await client.callTool({ name, arguments: { sessionId: 's-1', ...args } });
      expect(stub.calls.slice(before)).toEqual([method]);
      allowed = false;
      const denied = await client.callTool({ name, arguments: { sessionId: 's-1', ...args } });
      expect(resultText(denied.content)).toContain('E_CAPABILITY_DENY'); expect(stub.calls.length).toBe(before + 1);
    }
  });

  it('old injected hosts do not advertise optional action methods they lack', async () => {
    const facade = new AgentBrowserFacade({ api: {} as never });
    const client = await connect({ facade, policy: permissivePolicy() });
    const listed = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of ['vb_select', 'vb_select_values', 'vb_check', 'vb_append', 'vb_pointer', 'vb_drag', 'vb_forms', 'vb_dialogs', 'vb_dialog_respond']) {
      expect(listed).not.toContain(name);
      expect(resultText((await client.callTool({ name, arguments: { sessionId: 's-1' } })).content)).toContain('E_TOOL_NOT_EXPOSED');
    }
  });
  it('catalog has no duplicate names and matches the availability table', () => {
    const catalogNames = TOOL_CATALOG.map((tool) => tool.name);
    expect(new Set(catalogNames).size).toBe(catalogNames.length);
    expect([...Object.keys(TOOL_AVAILABILITY)].sort()).toEqual([...catalogNames].sort());
  });

  it('only vb_ping / vb_explain_error run without a facade', () => {
    const withoutFacade = Object.entries(TOOL_AVAILABILITY)
      .filter(([, value]) => value.servedWithoutFacade)
      .map(([name]) => name);
    expect(withoutFacade.sort()).toEqual(['vb_explain_error', 'vb_ping']);
  });

  it('vb_network_detail / vb_network_wait / vb_runtime_read 已是真能力：playwright 驱动上也暴露（TF-0103 / TF-0104 / TF-0105）', () => {
    const exposed = listExposedTools(permissivePolicy(), profileForDriver('playwright')).map(
      (tool) => tool.name,
    );
    expect(exposed).toContain('vb_network_detail');
    expect(exposed).toContain('vb_network_wait');
    expect(exposed).toContain('vb_runtime_read');
  });

  it('never advertises an unwired catalog entry, on any driver', () => {
    const unwired = Object.entries(TOOL_AVAILABILITY)
      .filter(([, value]) => !value.wired)
      .map(([name]) => name);
    expect(unwired.sort()).toEqual(
      ['vb_auth_state', 'vb_boundary_respond', 'vb_network_replay'].sort(),
    );

    const full = profileForDriver('host-api');
    const playwright = profileForDriver('playwright');
    for (const profile of [full, playwright, ASSUMED_FULL_DRIVER_PROFILE]) {
      const exposed = listExposedTools(permissivePolicy(), profile).map((tool) => tool.name);
      for (const name of unwired) {
        expect(exposed, `${name} on ${profile.kind}`).not.toContain(name);
      }
    }
  });

  it('gates tools by driver method support, not by catalog presence', () => {
    const playwright = profileForDriver('playwright');
    const exposed = listExposedTools(permissivePolicy(), playwright).map((tool) => tool.name);
    expect(exposed).toContain('vb_network_compare');
    expect(exposed).toContain('vb_verify_flow');

    const networkOnly: DriverProfile = {
      kind: 'playwright',
      methods: new Set(['networkListRequests']),
    };
    const names = listExposedTools(permissivePolicy(), networkOnly).map((tool) => tool.name);
    expect(names).toContain('vb_network_list');
    expect(names).not.toContain('vb_open');
    expect(exposureReason('vb_open', networkOnly)).toMatch(/does not serve open/u);
  });

  it('hides session tools entirely when no driver is active', () => {
    const names = listExposedTools(permissivePolicy(), NONE_DRIVER_PROFILE).map((tool) => tool.name);
    expect(names).toEqual(['vb_ping', 'vb_explain_error']);
    expect(isToolExposed('vb_open', NONE_DRIVER_PROFILE)).toBe(false);
  });

  it('deny-by-default policy still wins over a full driver', () => {
    const names = listExposedTools(resolveMcpPolicy({ env: {} }), ASSUMED_FULL_DRIVER_PROFILE).map(
      (tool) => tool.name,
    );
    expect(names).toEqual(['vb_ping']);
  });

  it('filterExposedTools keeps catalog order', () => {
    const order = TOOL_CATALOG.map((tool) => tool.name);
    const filtered = filterExposedTools(TOOL_CATALOG, profileForDriver('playwright')).map(
      (tool) => tool.name,
    );
    expect(filtered).toEqual(order.filter((name) => filtered.includes(name)));
  });

  it('advertises only tools the dispatcher actually serves', async () => {
    const stub = stubFacade();
    const client = await connect({
      policy: permissivePolicy(),
      facade: stub.facade,
      noDriver: true,
    });

    const listed = (await client.listTools()).tools.map((tool) => tool.name);
    expect(listed.length).toBeGreaterThan(20);

    for (const name of listed) {
      const response = await client.callTool({ name, arguments: CALL_ARGS });
      const text = resultText(response.content);
      expect(text, `${name} fell through to E_NOT_IMPLEMENTED`).not.toContain('E_NOT_IMPLEMENTED');
      expect(text, `${name} was advertised but not exposed`).not.toContain('E_TOOL_NOT_EXPOSED');
    }
  });

  it('reports denied execution as not started without calling the facade',async()=>{
    const stub=stubFacade();
    const client=await connect({policy:resolveMcpPolicy({groups:'',caps:'',env:{}}),facade:stub.facade,noDriver:true});
    try {
      const response=await client.callTool({name:'vb_click',arguments:{sessionId:'s',selector:'button'}});
      const result=JSON.parse((response.content as Array<{text:string}>)[0]!.text);
      expect(result.ok).toBe(false);
      expect(result.error.details.recoveryHint).toMatchObject({category:'denied',retryable:false,execution:'not_started'});
      expect(stub.calls).toEqual([]);
    }finally{await client.close();}
  });

  it('wires vb_network_compare to the facade', async () => {
    const stub = stubFacade();
    const client = await connect({
      policy: permissivePolicy(),
      facade: stub.facade,
      noDriver: true,
    });

    const response = await client.callTool({
      name: 'vb_network_compare',
      arguments: { sessionId: 's-1', baseline: 'n-1', current: 'n-2' },
    });
    expect(resultText(response.content)).not.toContain('E_NOT_IMPLEMENTED');
    expect(stub.calls).toContain('networkCompare');

    const missing = await client.callTool({
      name: 'vb_network_compare',
      arguments: { sessionId: 's-1' },
    });
    expect(resultText(missing.content)).toContain('E_ARG');
  });

  it('refuses an unexposed tool with a stable code instead of E_NOT_IMPLEMENTED', async () => {
    const client = await connect({ policy: permissivePolicy(), noDriver: true });

    const listed = (await client.listTools()).tools.map((tool) => tool.name);
    expect(listed).toEqual(['vb_ping', 'vb_explain_error']);

    const response = await client.callTool({
      name: 'vb_auth_state',
      arguments: { sessionId: 's-1' },
    });
    const text = resultText(response.content);
    expect(text).toContain('E_TOOL_NOT_EXPOSED');
    expect(text).not.toContain('E_NOT_IMPLEMENTED');
  });

  it('offline mode still serves vb_explain_error end to end', async () => {
    const client = await connect({ policy: permissivePolicy(), noDriver: true });
    const response = await client.callTool({
      name: 'vb_explain_error',
      arguments: { error: 'TypeError: boom\n    at app.min.js:1:1' },
    });
    expect(resultText(response.content)).not.toContain('E_TOOL_NOT_EXPOSED');
  });
});
