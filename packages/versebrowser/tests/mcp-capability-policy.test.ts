import { describe, expect, it } from 'vitest';
import {
  McpPolicyError,
  assertToolAllowed,
  capabilitiesForGroups,
  filterTools,
  isToolAllowed,
  parseCapabilityList,
  parseToolGroupList,
  requiredCapability,
  resolveMcpPolicy,
} from '../src/mcp/capability-policy';

const tools = [
  { name: 'vb_ping' },
  { name: 'vb_open' },
  { name: 'vb_nav' },
  { name: 'vb_screenshot' },
  { name: 'vb_explain_error' },
  { name: 'vb_network_list' },
  { name: 'vb_full_access_revoke' },
  { name: 'vb_unknown' },
];

describe('mcp capability-policy', () => {
  it('defaults to deny-by-default (no groups, no capabilities)', () => {
    const policy = resolveMcpPolicy({ env: {} });
    expect(policy.groups).toEqual([]);
    expect(policy.capabilities).toEqual([]);
    expect(filterTools(tools, policy).map((t) => t.name)).toEqual(['vb_ping']);
  });

  it('policy surface is only groups/capabilities (no dead development flag)', () => {
    // VERSEBROWSER_DEV set a `development` field that nothing ever read; it was removed so the
    // env var can no longer imply an effect the product does not have.
    const policy = resolveMcpPolicy({ env: { VERSEBROWSER_DEV: '1' } as NodeJS.ProcessEnv });
    expect(Object.keys(policy).sort()).toEqual(['capabilities', 'groups']);
    const withOption = resolveMcpPolicy({ development: true, env: {} } as never);
    expect(Object.keys(withOption).sort()).toEqual(['capabilities', 'groups']);
  });

  it('grants only explicit capabilities and groups', () => {
    const policy = resolveMcpPolicy({
      groups: 'core,network',
      caps: 'browser.open,browser.navigate,browser.observe,network.read',
      env: {},
    });
    expect(filterTools(tools, policy).map((t) => t.name)).toEqual([
      'vb_ping',
      'vb_open',
      'vb_nav',
      'vb_screenshot',
      'vb_network_list',
    ]);
  });

  it('rejects wildcards and unknown capabilities', () => {
    expect(() => parseCapabilityList('all')).toThrow(McpPolicyError);
    expect(() => parseCapabilityList('*')).toThrow(McpPolicyError);
    expect(() => parseCapabilityList('browser.open,nope')).toThrow(/Unknown capability/u);
    expect(() => parseToolGroupList('core,nope')).toThrow(/Unknown tool group/u);
  });

  it('uses the group config code for group wildcards, not the capability one', () => {
    // README promises E_GROUP_CONFIG for group wildcards. Both list parsers used to share one
    // parseList that always raised E_CAPABILITY_CONFIG, so a caller keying on the documented code
    // could not tell a groups mistake from a capabilities mistake.
    const codeOf = (fn: () => unknown): string | undefined => {
      try { fn(); return undefined; } catch (error) { return (error as { code?: string }).code; }
    };
    expect(codeOf(() => parseToolGroupList('all'))).toBe('E_GROUP_CONFIG');
    expect(codeOf(() => parseToolGroupList('*'))).toBe('E_GROUP_CONFIG');
    expect(codeOf(() => parseToolGroupList('core,nope'))).toBe('E_GROUP_CONFIG');
    expect(codeOf(() => parseCapabilityList('all'))).toBe('E_CAPABILITY_CONFIG');
    expect(codeOf(() => parseCapabilityList('*'))).toBe('E_CAPABILITY_CONFIG');
    expect(codeOf(() => parseCapabilityList('bogus.cap'))).toBe('E_CAPABILITY_CONFIG');
    // The group wildcard message must not talk about capabilities.
    expect(() => parseToolGroupList('all')).toThrow(/tool group/iu);
  });

  it('deny assert is fail-closed for unknown tools', () => {
    const policy = resolveMcpPolicy({ groups: 'core', caps: 'browser.open', env: {} });
    expect(() => assertToolAllowed('vb_unknown', policy)).toThrow(/Unknown tool/u);
    expect(() => assertToolAllowed('vb_open', policy)).not.toThrow();
    expect(() => assertToolAllowed('vb_explain_error', policy)).toThrow(/tool group|capability/u);

    const debugPolicy = resolveMcpPolicy({
      groups: 'core,debug',
      caps: 'browser.open,debug.console',
      env: {},
    });
    expect(() => assertToolAllowed('vb_explain_error', debugPolicy)).toThrow(/capability debug\.explain/u);
  });

  it('requiredCapability maps planned tools and leaves vb_ping free', () => {
    expect(requiredCapability('vb_ping')).toBeNull();
    expect(requiredCapability('vb_open')).toBe('browser.open');
    expect(requiredCapability('vb_missing')).toBeUndefined();
  });

  it('capabilitiesForGroups expands group allowlist', () => {
    expect(capabilitiesForGroups(['core']).sort()).toEqual(
      ['browser.act', 'browser.close', 'browser.download', 'browser.navigate', 'browser.observe', 'browser.open', 'browser.semantic', 'browser.upload'].sort(),
    );
    expect(isToolAllowed('vb_open', resolveMcpPolicy({ env: {} }))).toBe(false);
  });

  it('browser.* capabilities are first-class and deny with stable codes', () => {
    const policy = resolveMcpPolicy({ groups: 'core', caps: 'browser.open', env: {} });

    // Not granted → E_CAPABILITY_DENY with required_capability detail
    try {
      assertToolAllowed('vb_click', policy);
      expect.unreachable('vb_click must be denied');
    } catch (error) {
      const err = error as McpPolicyError;
      expect(err.code).toBe('E_CAPABILITY_DENY');
      expect(err.details?.required_capability).toBe('browser.act');
    }

    // Outside groups → E_GROUP_DENY
    try {
      assertToolAllowed('vb_explain_error', policy);
      expect.unreachable('vb_explain_error must be group-denied');
    } catch (error) {
      expect((error as McpPolicyError).code).toBe('E_GROUP_DENY');
    }

    // Unknown tool → E_TOOL_DENY
    try {
      assertToolAllowed('vb_nope', policy);
      expect.unreachable('unknown tool must be denied');
    } catch (error) {
      expect((error as McpPolicyError).code).toBe('E_TOOL_DENY');
    }

    // Granted browser.open is allowed
    expect(() => assertToolAllowed('vb_open', policy)).not.toThrow();
  });

  it('every non-ping tool maps to a browser.* or sibling capability (no free drive)', () => {
    const driveTools = [
      'vb_open',
      'vb_nav',
      'vb_click',
      'vb_type',
      'vb_snapshot',
      'vb_screenshot',
      'vb_close',
    ];
    for (const name of driveTools) {
      const cap = requiredCapability(name);
      expect(cap, name).toBeTruthy();
      expect(String(cap).startsWith('browser.'), name).toBe(true);
    }
  });
});
