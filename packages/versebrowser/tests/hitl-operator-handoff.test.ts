/**
 * TF-0167 item 1 — the POSITIVE operator hand-off.
 *
 * Existing coverage proves the agent cannot approve its own gate (a negative) and that the gate
 * survives a restart. This closes the other half on the real upstream path with a real browser:
 * a synthetic account signs in, the server expires the session, automation pauses, an out-of-band
 * operator (holding a secret the agent surface never sees) completes the human step, and the agent
 * then resumes, re-observes and submits EXACTLY once.
 *
 * Both out-of-band values are asserted absent from every agent-facing result:
 *   - the operator's web secret (it only ever travels on a direct fetch to the operator origin)
 *   - the HITL resume token (it only ever travels through `<ws>/.ae/sessions/_operator/`)
 */
import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import { HitlSessionStore } from '../src/engine/hitl-checkpoint.ts';
import { getWorkspaceSessionsRoot } from '../src/host/workspace-paths.ts';
import { sessionIdOf } from './session-result.ts';

const refFor = (result: { data?: { snapshot?: unknown } }, label: string): string | undefined => {
  const line = String(result.data?.snapshot ?? '').split('\n').find((l) => l.includes(label)) ?? '';
  return (line.match(/\[([^\]\s]+)\]/) ?? [])[1];
};
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

it('lets an out-of-band operator approve the gate, then the agent re-observes and submits once', async () => {
  const OPERATOR_SECRET = 'operator-secret-' + Math.random().toString(36).slice(2);
  const receipts: string[] = [];
  let phase: 'active' | 'challenge' = 'active';
  const cookies = new Map<string, string>();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const html = (body: string) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>HITL</title>${body}`); };
    // The operator channel: a separate origin-facing route guarded by a secret the agent never gets.
    if (url.pathname === '/operator') {
      if (req.headers['x-operator'] !== OPERATOR_SECRET) { res.writeHead(403); res.end('Operator denied'); return; }
      if (req.method === 'POST') { phase = 'active'; res.end('approved'); return; }
      html('<h1>Fixture operator</h1><button>Approve</button>'); return;
    }
    if (url.pathname === '/receipt' && req.method === 'POST') { receipts.push('submit'); res.end('ok'); return; }
    if (url.pathname === '/login' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
        const params = new URLSearchParams(body);
        if (params.get('account') !== 'alpha' || params.get('password') !== 'fixture-password') { res.writeHead(401); html('<h1>Sign in</h1><form method="post" action="/login"><input id="account" name="account"><input id="password" name="password" type="password"><button id="signin">Sign in</button></form>'); return; }
        const token = Math.random().toString(36).slice(2); cookies.set(token, 'alpha');
        res.writeHead(303, { location: '/app', 'set-cookie': `vb_auth=${token}; Path=/; HttpOnly` }); res.end();
      });
      return;
    }
    if (url.pathname === '/expire' && req.method === 'POST') { phase = 'challenge'; res.end('expired'); return; }
    if (url.pathname === '/app') {
      const raw = String(req.headers.cookie ?? '').split(';').map((p) => p.trim()).find((p) => p.startsWith('vb_auth='))?.slice('vb_auth='.length);
      if (!raw || !cookies.has(raw)) { res.writeHead(401); html('<h1>Sign in required</h1>'); return; }
      if (phase === 'challenge') { html('<h1>Human verification required</h1><p>operator step pending</p>'); return; }
      html('<h1>Protected order</h1><button type="button" onclick="fetch(\'/receipt\',{method:\'POST\'})">Submit order</button><button type="button" onclick="fetch(\'/expire\',{method:\'POST\'})">Expire sign-in</button>');
      return;
    }
    html('<h1>Sign in</h1><form method="post" action="/login"><input id="account" name="account"><input id="password" name="password" type="password"><button id="signin">Sign in</button></form>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'vb-hitl-operator-'));
  const { facade } = await createStandaloneFacade({ backend: 'upstream', workspaceRoot, allowedOrigins: [origin] });
  const seen: unknown[] = [];
  const record = <T,>(r: T): T => { seen.push(r); return r; };
  try {
    const opened = record(await facade.open({ url: `${origin}/login` }));
    const sessionId = sessionIdOf(opened);

    // synthetic account signs in
    await facade.type(sessionId, '#account', 'alpha');
    await facade.type(sessionId, '#password', 'fixture-password');
    await facade.click(sessionId, '#signin');
    await sleep(500);
    const afterLogin = record(await facade.snapshot(sessionId));
    expect(String((afterLogin.data as { snapshot?: unknown })?.snapshot)).toContain('Protected order');

    // the order button is observed BEFORE the human step — this ref must not survive the gate
    const prePauseRef = refFor(afterLogin as { data?: { snapshot?: unknown } }, 'Submit order');
    expect(prePauseRef, 'the snapshot must expose the order button').toBeTruthy();

    // session expires -> automation must pause instead of pretending it can continue
    await facade.click(sessionId, '#expire');
    await sleep(400);
    const paused = record(await facade.pauseForHuman({ sessionId, reason: 'login_wall', message: 'human must re-verify' }));
    expect((paused.data as { paused?: boolean }).paused ?? paused.ok).toBeTruthy();
    const blocked = record(await facade.click(sessionId, `[data-vb-ref="${prePauseRef}"]`));
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe('E_HITL_PAUSED');
    expect(receipts, 'nothing may reach the server while paused').toEqual([]);

    // OUT-OF-BAND OPERATOR: holds its own secret; never touches a browser tool.
    const approve = await fetch(`${origin}/operator`, { method: 'POST', headers: { 'x-operator': OPERATOR_SECRET } });
    expect(approve.status).toBe(200);
    const token = (await new HitlSessionStore(getWorkspaceSessionsRoot(workspaceRoot)).readOperatorResumeToken(sessionId))!;
    expect(token, 'the operator channel issues the one-time resume token').toBeTruthy();

    const resumed = record(await facade.resumeAfterHuman(sessionId, token));
    expect(resumed.ok, JSON.stringify(resumed)).toBe(true);

    // A ref observed before the human acted must not be reusable — re-observation is required.
    const stale = record(await facade.click(sessionId, `[data-vb-ref="${prePauseRef}"]`));
    expect(stale.ok, 'a pre-gate ref must not act after the resume').toBe(false);
    expect(stale.error?.code).toBe('E_STALE_REF');
    expect(receipts).toEqual([]);

    // The compliant path: observe again, then act. Exactly one submit.
    await facade.nav(sessionId, `${origin}/app`);
    await sleep(400);
    const afterResume = record(await facade.snapshot(sessionId));
    const freshRef = refFor(afterResume as { data?: { snapshot?: unknown } }, 'Submit order');
    expect(freshRef, 'the re-observed page must expose the order button').toBeTruthy();
    await facade.click(sessionId, `[data-vb-ref="${freshRef}"]`);
    await sleep(700);
    expect(receipts, 'exactly one submit, no replay').toEqual(['submit']);

    // Neither out-of-band value may appear in any agent-facing result.
    const dump = JSON.stringify(seen);
    expect(dump, 'the operator secret must never reach the agent surface').not.toContain(OPERATOR_SECRET);
    expect(dump, 'the resume token must never reach the agent surface').not.toContain(token);
    await facade.close(sessionId);
  } finally {
    await facade.dispose?.().catch?.(() => {});
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}, 90_000);