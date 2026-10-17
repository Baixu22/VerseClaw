import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateRedline,
  assertRedlineAllowed,
  isRedlineDocumentation,
  REDLINE_DOCS_SNIPPET,
} from '../src/security/redline-policy';
import {
  assertAuthorizationDeclared,
  getAutomationPlaybookById,
  AUTHORIZATION_REQUIRED_PLAYBOOK_IDS,
} from '../src/core/automation-playbooks';
import { HitlSessionStore, isHumanOnlyGate } from '../src/engine/hitl-checkpoint';
import { getWorkspaceSessionsRoot } from '../src/host/workspace-paths';
import { AgentBrowserFacade } from '../src/engine/facade';
import type { AgentBrowserHostApi } from '../src/types/host-api';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server';
import { resolveMcpPolicy } from '../src/mcp/capability-policy';

describe('redline policy (TF-0040)', () => {
  it('rejects captcha bypass productization', () => {
    const d = evaluateRedline('integrate capsolver captcha bypass');
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('E_REDLINE_CAPTCHA_BYPASS');
  });

  it('rejects mass signup playbooks', () => {
    const d = evaluateRedline('批量注册 playbook for gmail');
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('E_REDLINE_MASS_SIGNUP');
  });

  it('allows negated red-line documentation', () => {
    expect(isRedlineDocumentation('不提供打码 / CAPTCHA bypass 产品化')).toBe(true);
    expect(isRedlineDocumentation('禁止批量注册')).toBe(true);
    expect(evaluateRedline('不提供打码 / CAPTCHA bypass 产品化').allowed).toBe(true);
    expect(evaluateRedline('禁止批量注册').allowed).toBe(true);
    expect(evaluateRedline(REDLINE_DOCS_SNIPPET).allowed).toBe(true);
  });

  it('allows legitimate authorized signup acceptance', () => {
    expect(evaluateRedline('staging 注册页开发级验收 Evidence Pack').allowed).toBe(true);
  });

  it('assertRedlineAllowed throws with stable code', () => {
    try {
      assertRedlineAllowed('过码平台对接');
      expect.unreachable();
    } catch (error) {
      expect((error as { code?: string }).code).toBe('E_REDLINE_CAPTCHA_BYPASS');
    }
  });

  it('docs snippet states red lines and HITL', () => {
    expect(REDLINE_DOCS_SNIPPET).toMatch(/CAPTCHA|打码/u);
    expect(REDLINE_DOCS_SNIPPET).toMatch(/HITL/);
    expect(REDLINE_DOCS_SNIPPET).toMatch(/批量注册/u);
  });
});

describe('authorization gate (TF-0038)', () => {
  it('requires declaration for authorized signup playbook', () => {
    expect(AUTHORIZATION_REQUIRED_PLAYBOOK_IDS.has('authorized_signup_acceptance')).toBe(true);
    expect(getAutomationPlaybookById('authorized_signup_acceptance')?.risk).toBe('high');
    expect(() => assertAuthorizationDeclared('authorized_signup_acceptance', undefined)).toThrow(
      /authorization declaration/iu,
    );
    expect(() =>
      assertAuthorizationDeclared('authorized_signup_acceptance', {
        targetUrl: 'http://127.0.0.1:1/',
        source: 'local-fixture',
        declaredAt: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  it('signup playbook prompt forbids bypass and requires Evidence', () => {
    const playbook = getAutomationPlaybookById('authorized_signup_acceptance');
    expect(playbook?.prompt).toMatch(/HITL|绝不 bypass|禁止/u);
    expect(playbook?.prompt).toMatch(/Evidence Pack/u);
    expect(playbook?.prompt).toMatch(/vault/u);
  });
});

describe('HITL checkpoint (TF-0039)', () => {
  it('pause blocks automation until resume with token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-hitl-'));
    const store = new HitlSessionStore(root);
    await store.pause({
      sessionId: 's1',
      reason: 'captcha_human_required',
      message: 'human solves',
      credentialRefs: ['cred-1'],
    });
    expect(store.isPaused('s1')).toBe(true);
    expect(() => store.assertResumed('s1')).toThrow(/HITL paused/);

    const cp = store.get('s1')!;
    expect(cp.credentialRefs).toEqual(['cred-1']);
    // No plaintext password field
    expect(JSON.stringify(cp)).not.toMatch(/password\s*:/iu);
    // TF-0167: the checkpoint carries no usable token, only a salted hash
    expect(cp).not.toHaveProperty('resumeToken');
    expect(cp.resumeTokenHash).toMatch(/^[0-9a-f]{64}$/);

    await expect(store.resume('s1', 'bad')).rejects.toMatchObject({ code: 'E_HITL_DENIED' });

    // the human operator channel is the only place the raw token exists
    const issued = await store.readOperatorResumeToken('s1');
    expect(issued, 'the operator channel must hold the one-time token').toBeTruthy();
    const persisted = await readFile(join(root, 's1', 'hitl-checkpoint.json'), 'utf8');
    expect(persisted, 'the persisted checkpoint must not contain the raw token').not.toContain(issued!);

    const resumed = await store.resume('s1', issued!);
    expect(resumed.status).toBe('running');
    expect(() => store.assertResumed('s1')).not.toThrow();
    expect(resumed.audit.some((e) => e.event === 'pause')).toBe(true);
    expect(resumed.audit.some((e) => e.event === 'resume')).toBe(true);
  });

  it('classifies human-only gates', () => {
    expect(isHumanOnlyGate('captcha_human_required')).toBe(true);
    expect(isHumanOnlyGate('boundary_confirm')).toBe(false);
  });
});

/**
 * TF-0167 item 3: a human gate must be resumable exactly once.
 *
 * HitlSessionStore existed but was only exported, never used by the engine. These cover the
 * contract the node requires: pause records a reason and hands back a token, a wrong token is
 * refused, completing the gate does NOT re-validate the page, and the token cannot be replayed
 * afterwards (which would let a caller skip the human step).
 */
describe('HITL checkpoint lifecycle (TF-0167)', () => {
  it('refuses a wrong token, resumes once, and refuses the replay', async () => {
    const store = new HitlSessionStore(await mkdtemp(join(tmpdir(), 'vb-hitl-')));

    const paused = await store.pause({
      sessionId: 's-1',
      reason: 'login_wall',
      message: 'sign-in expired; a human must complete verification',
    });
    expect(paused.status).toBe('paused');
    expect(paused.reason).toBe('login_wall');
    expect(store.isPaused('s-1')).toBe(true);
    expect(isHumanOnlyGate(paused.reason)).toBe(true);
    // the caller that paused does not receive a usable token
    expect(paused).not.toHaveProperty('resumeToken');

    // a token that was never issued must not resume the gate
    await expect(store.resume('s-1', 'not-the-token')).rejects.toMatchObject({ code: 'E_HITL_DENIED' });

    // the issued token, picked up from the operator channel, resumes it once
    const issued = (await store.readOperatorResumeToken('s-1'))!;
    expect(issued, 'the operator channel must hold the issued token').toBeTruthy();
    const resumed = await store.resume('s-1', issued);
    expect(resumed.status).toBe('running');

    // replaying the same token would skip the human step, so it must be refused
    await expect(store.resume('s-1', issued)).rejects.toMatchObject({ code: 'E_HITL_DENIED' });

    // a completed gate is equally not resumable
    await store.complete('s-1');
    await expect(store.resume('s-1', issued)).rejects.toMatchObject({ code: 'E_HITL_DENIED' });
  });

  /**
   * complete() is documented as the way to close a gate for a session that is already gone, but it
   * read only the in-memory map. Called as the first operation of a restarted process it silently
   * returned undefined and left the persisted checkpoint `paused` - so a dead session's gate never
   * closed and every later state-changing action stayed refused. It now reads the persisted
   * checkpoint, like ensureLoaded / assertResumedPersisted / humanGateStatus already do.
   */
  it('closes a persisted gate when complete() is the first call after a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-hitl-complete-'));
    await new HitlSessionStore(root).pause({ sessionId: 'orphan', reason: 'login_wall', message: 'operator left' });

    // A new store instance stands in for a restarted host: complete() is its first operation.
    const restarted = new HitlSessionStore(root);
    const completed = await restarted.complete('orphan');
    expect(completed?.status, 'complete() must see the persisted checkpoint, not just its own map').toBe('completed');

    const onDisk = JSON.parse(await readFile(join(root, 'orphan', 'hitl-checkpoint.json'), 'utf8'));
    expect(onDisk.status).toBe('completed');
    // A completed gate is terminal: the one-time token cannot reopen it either.
    const token = await restarted.readOperatorResumeToken('orphan');
    await expect(restarted.resume('orphan', token ?? 'missing')).rejects.toMatchObject({ code: 'E_HITL_DENIED' });
  });

  it('rotates the token on every pause so an older token cannot open a newer gate', async () => {
    const store = new HitlSessionStore(await mkdtemp(join(tmpdir(), 'vb-hitl-')));
    await store.pause({ sessionId: 's-rotate', reason: 'mfa', message: 'first gate' });
    const first = (await store.readOperatorResumeToken('s-rotate'))!;

    await store.pause({ sessionId: 's-rotate', reason: 'mfa', message: 'second gate' });
    const second = (await store.readOperatorResumeToken('s-rotate'))!;
    expect(second).not.toBe(first);

    // the superseded token is dead even though the gate is open again
    await expect(store.resume('s-rotate', first)).rejects.toMatchObject({ code: 'E_HITL_DENIED' });
    const resumed = await store.resume('s-rotate', second);
    expect(resumed.status).toBe('running');
  });

  it('keeps credentials out of the checkpoint and records the refusal in the audit trail', async () => {
    const store = new HitlSessionStore(await mkdtemp(join(tmpdir(), 'vb-hitl-')));
    const paused = await store.pause({ sessionId: 's-2', reason: 'mfa', message: 'second factor required' });

    // only references are ever stored; the checkpoint never carries plaintext secrets
    expect(paused.credentialRefs).toEqual([]);
    expect(JSON.stringify(paused)).not.toContain('secret_value');

    await expect(store.resume('s-2', 'wrong')).rejects.toMatchObject({ code: 'E_HITL_DENIED' });
    const after = store.get('s-2');
    expect(after?.audit.some((event) => event.event === 'deny')).toBe(true);
  });
});

/**
 * TF-0167 item 3, enforcement half: a paused session must not be able to act.
 *
 * Measured before this existed (2026-10-10 control experiment, challenge-free fixture): a write
 * still landed after pauseForHuman, because HitlSessionStore.assertResumed() had no callers at all.
 * The store recorded a checkpoint but nothing consulted it on the action path, so the earlier
 * "zero writes while gated" observation was really the auth fixture's own challenge phase.
 *
 * Observation deliberately stays open: the continuation contract requires the agent to re-observe
 * the page after a human finishes, so humanGateStatus must keep answering while paused.
 *
 * The stub api records every call, which is what makes fail-closed checkable: a refused action must
 * never reach the driver at all.
 */
describe('HITL gate enforcement (TF-0167)', () => {
  const stub = () => {
    const reached: string[] = [];
    const api = {
      click: async () => { reached.push('click'); return { success: true }; },
      type: async () => { reached.push('type'); return { success: true }; },
      navigate: async () => { reached.push('navigate'); return { success: true }; },
      waitForSelector: async () => ({ success: true }),
      // The session guard is awaited now, so it must answer: only a definite E_NO_SESSION refuses.
      getConsoleMessages: async () => ({ success: true, messages: [] }),
    } as unknown as AgentBrowserHostApi;
    return { api, reached };
  };

  it('refuses state-changing actions while paused and never reaches the driver', async () => {
    const { api, reached } = stub();
    const workspace = await mkdtemp(join(tmpdir(), 'vb-hitl-gate-'));
    // A fake session id is fine: the stub answers getConsoleMessages, so sessionExists returns
    // 'unknown' rather than a definite E_NO_SESSION and the guard proceeds (sibling semantics).
    const facade = new AgentBrowserFacade({ api, workspaceRoot: workspace });

    const paused = await facade.pauseForHuman({ sessionId: 's-gate', reason: 'login_wall', message: 'human must sign in' });
    expect(paused.ok).toBe(true);
    const pausedData = (paused.data ?? {}) as Record<string, unknown>;

    // the gate is still observable, so a host can report why it stopped
    const status = await facade.humanGateStatus('s-gate');
    expect(status.ok).toBe(true);
    expect(status.data).toMatchObject({ paused: true, reason: 'login_wall' });

    // TF-0167: the tool surface hands out neither the token, nor the material used to verify it, nor
    // even where the token lives — these results reach the agent, and for any host with filesystem
    // access a path is a pointer to the secret.
    expect(pausedData).not.toHaveProperty('resumeToken');
    expect(pausedData).not.toHaveProperty('resumeTokenHash');
    expect(pausedData).not.toHaveProperty('resumeTokenSalt');
    expect(pausedData).not.toHaveProperty('operatorTokenPath');
    expect((status.data ?? {}) as Record<string, unknown>).not.toHaveProperty('resumeToken');
    expect((status.data ?? {}) as Record<string, unknown>).not.toHaveProperty('operatorTokenPath');

    // A human-side tool reads the operator channel through the store; the channel follows THIS
    // facade's workspace rather than the process-wide default.
    const operatorStore = new HitlSessionStore(getWorkspaceSessionsRoot(workspace));
    expect(operatorStore.operatorTokenPath('s-gate').startsWith(workspace), `operator channel must live under ${workspace}`).toBe(true);
    const issued = (await operatorStore.readOperatorResumeToken('s-gate'))!;
    expect(issued).toBeTruthy();
    expect(JSON.stringify(paused), 'the tool result must not carry the token').not.toContain(issued);
    expect(String(paused.content), 'the message must not carry the token').not.toContain(issued);

    const attempts: Array<[string, () => Promise<{ ok: boolean; error?: { code?: string; details?: Record<string, unknown> } }>]> = [
      ['click', () => facade.click('s-gate', '#save')],
      ['type', () => facade.type('s-gate', '#note', 'x')],
      ['nav', () => facade.nav('s-gate', 'https://example.test/next')],
    ];
    for (const [label, attempt] of attempts) {
      const blocked = await attempt();
      expect(blocked.ok, `${label} must be refused while paused`).toBe(false);
      expect(blocked.error?.code, `${label} must fail closed with the HITL code`).toBe('E_HITL_PAUSED');
      // the reason travels with the refusal, so the host does not have to guess
      expect(blocked.error?.details?.checkpoint, `${label} must carry the checkpoint`).toMatchObject({
        reason: 'login_wall',
        status: 'paused',
      });
      // browser-ops section 2 promises the refusal carries recoveryHint.needs_user, not merely that
      // the standalone helper would classify the code that way.
      expect(blocked.error?.details?.recoveryHint, `${label} must carry the needs_user hint`).toMatchObject({
        category: 'needs_user',
        needs_user: true,
      });
    }
    expect(reached, 'a refused action must never reach the driver').toEqual([]);

    // only the operator channel's token resumes the gate, and doing so reopens the action path
    await expect(facade.resumeAfterHuman('s-gate', 'not-the-token')).resolves.toMatchObject({ ok: false, error: { code: 'E_HITL_DENIED' } });
    const resumed = await facade.resumeAfterHuman('s-gate', issued);
    expect(resumed.ok).toBe(true);
    await facade.click('s-gate', '#save');
    expect(reached).toEqual(['click']);
  });

  it('keeps the gate closed across a restart by reading the persisted checkpoint', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'vb-hitl-restart-'));
    const before = stub();
    const facadeA = new AgentBrowserFacade({ api: before.api, workspaceRoot: workspace });
    await facadeA.pauseForHuman({ sessionId: 'r-1', reason: 'login_wall', message: 'human must sign in' });

    // A restart means a new facade with an empty in-memory map. The persisted gate must still hold:
    // otherwise a restart is a fail-open bypass of the very guard this suite is about.
    const after = stub();
    const facadeB = new AgentBrowserFacade({ api: after.api, workspaceRoot: workspace });
    const blocked = await facadeB.click('r-1', '#save');
    expect(blocked.ok, 'a restart must not silently drop the human gate').toBe(false);
    expect(blocked.error?.code).toBe('E_HITL_PAUSED');
    expect(after.reached).toEqual([]);

    // The operator channel's token still resumes it, and the action path reopens.
    const store = new HitlSessionStore(getWorkspaceSessionsRoot(workspace));
    const token = (await store.readOperatorResumeToken('r-1'))!;
    expect(token).toBeTruthy();
    expect((await facadeB.resumeAfterHuman('r-1', token)).ok).toBe(true);
    await facadeB.click('r-1', '#save');
    expect(after.reached).toEqual(['click']);
  });

  /**
   * TF-0167 AC#3: after a human acts, the agent must re-observe — it may not assume the page it
   * inspected before the pause is still the page in front of it.
   *
   * Measured before this existed, on the real upstream path with a server-side receipt: the resume
   * result said "re-observe before acting", but a ref observed BEFORE the pause still submitted
   * (receipt count went 0 -> 1). The advisory is now enforced: ref-based actions are refused with
   * E_STALE_REF until the caller takes a fresh observation. E_STALE_REF is reused deliberately so
   * hosts receive the existing stale/reobserve recovery hint.
   */
  it('refuses a ref observed before the pause until the caller re-observes', async () => {
    const { api, reached } = stub();
    (api as unknown as { takeSnapshot: () => Promise<unknown> }).takeSnapshot = async () => ({
      success: true,
      snapshot: '# snapshot\n- title: HITL\n',
      items: [],
    });
    const workspace = await mkdtemp(join(tmpdir(), 'vb-hitl-reobserve-'));
    const facade = new AgentBrowserFacade({ api, workspaceRoot: workspace });
    const session = 'h-reobserve';

    await facade.pauseForHuman({ sessionId: session, reason: 'login_wall', message: 'human must sign in' });
    const store = new HitlSessionStore(getWorkspaceSessionsRoot(workspace));
    const token = (await store.readOperatorResumeToken(session))!;
    expect((await facade.resumeAfterHuman(session, token)).ok).toBe(true);

    // A ref minted before the human acted may point at a page the human changed.
    const stale = await facade.click(session, '[data-vb-ref="u-1-e1"]');
    expect(stale.ok, 'a pre-pause ref must not be actionable after a resume').toBe(false);
    expect(stale.error?.code).toBe('E_STALE_REF');
    // Reusing the code is meant to hand hosts the existing stale hint, so the hint must actually be
    // attached - not merely derivable from the code by a helper the caller may not run.
    expect(stale.error?.details?.recoveryHint, 'the stale/reobserve hint must travel with the reuse').toMatchObject({
      category: 'stale',
      reobserve: true,
    });
    expect(reached, 'a refused ref must never reach the driver').toEqual([]);

    // A plain selector is unaffected: the rule is specifically about observation-derived handles.
    await facade.click(session, '#save');
    expect(reached).toEqual(['click']);

    // Observing again satisfies the rule, and then a ref may be used.
    expect((await facade.snapshot(session)).ok).toBe(true);
    await facade.click(session, '[data-vb-ref="u-2-e1"]');
    expect(reached).toEqual(['click', 'click']);
  });

  /**
   * TF-0167: the re-observe rule is about the HANDLE, not the verb. Every state-changing action that
   * accepts a selector can consume an observation ref, so all of them must refuse a pre-gate ref
   * until the caller observes again. Before this, only click/type/press/select/check were guarded;
   * selectValues, appendText, pointer, drag, uploadFiles and downloadFile still acted on the stale
   * ref, which is the same "a pre-pause ref still submitted after resume" hole the rule closes.
   */
  it('refuses a pre-gate ref on every state-changing action that consumes one', async () => {
    const reached: string[] = [];
    const api = {
      click: async () => { reached.push('click'); return { success: true }; },
      type: async () => { reached.push('type'); return { success: true }; },
      selectValues: async () => { reached.push('selectValues'); return { success: true }; },
      appendText: async () => { reached.push('appendText'); return { success: true }; },
      pointer: async () => { reached.push('pointer'); return { success: true }; },
      drag: async () => { reached.push('drag'); return { success: true }; },
      uploadFiles: async () => { reached.push('uploadFiles'); return { success: true, pageId: 'p', files: [] }; },
      downloadFile: async () => ({ success: true, pageId: 'p', file: { reference: 'r', bytes: 1, mimeType: null }, status: 'completed' }),
      getConsoleMessages: async () => ({ success: true, messages: [] }),
    } as unknown as AgentBrowserHostApi;
    const workspace = await mkdtemp(join(tmpdir(), 'vb-hitl-reobserve-all-'));
    const facade = new AgentBrowserFacade({ api, workspaceRoot: workspace });
    const session = 'h-reobserve-all';
    const ref = '[data-vb-ref="u-1-e1"]';

    await facade.pauseForHuman({ sessionId: session, reason: 'login_wall', message: 'human must sign in' });
    const store = new HitlSessionStore(getWorkspaceSessionsRoot(workspace));
    const token = (await store.readOperatorResumeToken(session))!;
    expect((await facade.resumeAfterHuman(session, token)).ok).toBe(true);

    const attempts: Array<[string, () => Promise<{ ok: boolean; error?: { code?: string } }>]> = [
      ['selectValues', () => facade.selectValues(session, ref, ['x'])],
      ['appendText', () => facade.appendText(session, ref, 'x')],
      ['pointer', () => facade.pointer({ sessionId: session, action: 'hover', selector: ref })],
      ['drag-source', () => facade.drag({ sessionId: session, sourceSelector: ref, targetSelector: '#drop' })],
      ['drag-target', () => facade.drag({ sessionId: session, sourceSelector: '#card', targetSelector: ref })],
      ['uploadFiles', () => facade.uploadFiles({ sessionId: session, selector: ref, paths: ['/tmp/a'] })],
      ['downloadFile', () => facade.downloadFile({ sessionId: session, selector: ref, path: '/tmp/a' })],
    ];
    for (const [name, run] of attempts) {
      const result = await run();
      expect(result.ok, `${name} must refuse a pre-gate ref`).toBe(false);
      expect(result.error?.code, name).toBe('E_STALE_REF');
    }
    expect(reached, 'a refused ref must never reach the driver').toEqual([]);
  });
});

/**
 * TF-0167 over MCP: the human gate is an authority-plane surface, exposed deny-by-default.
 *
 * These assert the design rules instead of assuming them: exposure stays catalog ∩ policy ∩ driver
 * (without `authority.hitl` the tools are not even advertised, because the list is a promise and not
 * a wish); the resume token never travels through the tool surface, so the caller that paused cannot
 * approve its own gate; and a paused session refuses state-changing tools with E_HITL_PAUSED.
 */
describe('HITL gate over MCP (TF-0167)', () => {
  const connect = async (deps: Parameters<typeof createMcpServer>[0]) => {
    const server = createMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'vb-hitl-test', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  };
  const toolJson = (result: unknown) => {
    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
    return JSON.parse(content.filter((entry) => entry?.type === 'text').map((entry) => entry.text).join('\n'));
  };

  it('is advertised only with authority.hitl and never hands out the resume token', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'vb-hitl-mcp-'));
    const reached: string[] = [];
    const api = {
      getConsoleMessages: async () => ({ success: true, messages: [] }),
      navigate: async () => { reached.push('navigate'); return { success: true }; },
      waitForSelector: async () => ({ success: true }),
    } as unknown as AgentBrowserHostApi;
    const facade = new AgentBrowserFacade({ api, workspaceRoot: workspace });

    // The authority group alone is not enough: deny-by-default needs the capability too.
    const withoutCapability = await connect({ facade, policy: resolveMcpPolicy({ groups: 'authority', caps: 'authority.revoke', env: {} }) });
    const withoutNames = (await withoutCapability.listTools()).tools.map((tool) => tool.name);
    expect(withoutNames, 'a tool that is not granted must not be advertised').not.toContain('vb_pause_for_human');
    expect(withoutNames).not.toContain('vb_resume_after_human');

    // The action tool needs its own group and capability too, so that the refusal below comes from
    // the HITL gate rather than from the capability gate (the layers are independent on purpose).
    const client = await connect({ facade, policy: resolveMcpPolicy({ groups: 'core,authority', caps: 'browser.navigate,authority.hitl', env: {} }) });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['vb_pause_for_human', 'vb_human_gate_status', 'vb_resume_after_human']));

    // An unknown reason is refused by the schema/guard before anything happens.
    const bad = await client.callTool({ name: 'vb_pause_for_human', arguments: { sessionId: 'm1', reason: 'not-a-gate', message: 'x' } });
    expect(JSON.stringify(bad.content)).toContain('E_ARG');

    const paused = toolJson(await client.callTool({ name: 'vb_pause_for_human', arguments: { sessionId: 'm1', reason: 'login_wall', message: 'human must sign in' } }));
    expect(paused.ok, JSON.stringify(paused)).toBe(true);
    // The surface must not reveal the token, the hash material, or even where the token lives.
    const operatorStore = new HitlSessionStore(getWorkspaceSessionsRoot(workspace));
    const token = (await operatorStore.readOperatorResumeToken('m1'))!;
    expect(token, 'the operator channel holds the one-time token').toBeTruthy();
    expect(JSON.stringify(paused), 'the paused result must not carry the token').not.toContain(token);
    expect(JSON.stringify(paused)).not.toContain('operatorTokenPath');
    expect(paused.data).not.toHaveProperty('resumeTokenHash');

    // A state-changing tool is refused while paused, and the refusal names the human need.
    const blocked = toolJson(await client.callTool({ name: 'vb_nav', arguments: { sessionId: 'm1', url: 'https://example.test/next' } }));
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe('E_HITL_PAUSED');
    expect(reached, 'a refused action must never reach the driver').toEqual([]);

    // Status is readable and equally token-free.
    const status = toolJson(await client.callTool({ name: 'vb_human_gate_status', arguments: { sessionId: 'm1' } }));
    expect(status.data).toMatchObject({ paused: true, reason: 'login_wall' });
    expect(JSON.stringify(status)).not.toContain(token);

    // The advertisement is also part of the contract the model reads. TF-0167: the path to the
    // operator channel is deliberately never revealed, and docs/mcp.md says the surface "neither
    // mints that token, nor returns it, nor reveals where it lives" - the description used to
    // promise exactly that path, so it is pinned against drifting back.
    const advertised = (await client.listTools()).tools.find((tool) => tool.name === 'vb_human_gate_status');
    expect(advertised?.description ?? '', 'the status tool must not advertise the token location').not.toMatch(/token\s+path|operator\s+token|where it lives/i);

    // Only the operator's token resumes the gate; the surface cannot mint one.
    const wrong = toolJson(await client.callTool({ name: 'vb_resume_after_human', arguments: { sessionId: 'm1', resumeToken: 'not-the-token' } }));
    expect(wrong.ok).toBe(false);
    expect(wrong.error?.code).toBe('E_HITL_DENIED');
    const resumed = toolJson(await client.callTool({ name: 'vb_resume_after_human', arguments: { sessionId: 'm1', resumeToken: token } }));
    expect(resumed.ok, JSON.stringify(resumed)).toBe(true);

    // And the action path is open again.
    await client.callTool({ name: 'vb_nav', arguments: { sessionId: 'm1', url: 'https://example.test/after' } });
    expect(reached).toEqual(['navigate']);
  });
});
