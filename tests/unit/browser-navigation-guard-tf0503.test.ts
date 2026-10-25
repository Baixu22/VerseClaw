// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  approveBrowserPrivateNetwork,
  assertBrowserNavigationAllowed,
  setBrowserFirstPartyOriginProvider,
} from '../../electron/services/agent-browser-api';

describe('TF-0503 host browser navigation guard', () => {
  afterEach(() => setBrowserFirstPartyOriginProvider(null));

  it('lets a public navigation through untouched', async () => {
    await expect(assertBrowserNavigationAllowed('navigate', {
      sessionId: 's-public', url: 'https://example.com/a',
    })).resolves.toBeUndefined();
  });

  it('denies a private navigation by default with an explicit reason', async () => {
    await expect(assertBrowserNavigationAllowed('navigate', {
      sessionId: 's-deny', url: 'http://127.0.0.1:18789/admin',
    })).rejects.toThrow(/private-network-default-deny/);
  });

  it('denies the cloud metadata endpoint', async () => {
    let caught: unknown;
    try {
      await assertBrowserNavigationAllowed('open', { url: 'http://169.254.169.254/latest/meta-data' });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe('E_BROWSER_PRIVATE_NETWORK_DENIED');
  });

  it('does not gate non-navigation actions', async () => {
    await expect(assertBrowserNavigationAllowed('click', {
      sessionId: 's-click', selector: '#x',
    })).resolves.toBeUndefined();
  });

  it('allows a private origin only after a bounded supervised approval', async () => {
    const sessionId = 's-approved';
    setBrowserFirstPartyOriginProvider(() => []);
    await expect(assertBrowserNavigationAllowed('navigate', {
      sessionId, url: 'http://10.0.0.5/x',
    })).rejects.toThrow(/private-network-default-deny/);
    approveBrowserPrivateNetwork({ sessionId, origin: 'http://10.0.0.5', ttlMs: 60_000 });
    await expect(assertBrowserNavigationAllowed('navigate', {
      sessionId, url: 'http://10.0.0.5/x',
    })).resolves.toBeUndefined();
    // another session is not covered by that approval
    await expect(assertBrowserNavigationAllowed('navigate', {
      sessionId: 's-other', url: 'http://10.0.0.5/x',
    })).rejects.toThrow();
  });

  it('allows the host own running preview but never a forged localhost claim', async () => {
    setBrowserFirstPartyOriginProvider(() => []);
    await expect(assertBrowserNavigationAllowed('open', {
      url: 'http://localhost:8082/',
      workspaceId: 'ws-1',
      sessionId: 's-preview',
    })).rejects.toThrow(/private-network-default-deny/);
    setBrowserFirstPartyOriginProvider(() => ['http://localhost:8082']);
    await expect(assertBrowserNavigationAllowed('open', {
      url: 'http://localhost:8082/',
      workspaceId: 'ws-1',
      sessionId: 's-preview',
    })).resolves.toBeUndefined();
  });

  it('fails closed when the first-party provider itself throws', async () => {
    setBrowserFirstPartyOriginProvider(() => {
      throw new Error('workspace store unavailable');
    });
    await expect(assertBrowserNavigationAllowed('navigate', {
      sessionId: 's-throw', url: 'http://192.168.0.1/',
    })).rejects.toThrow(/private-network-default-deny/);
  });
});
