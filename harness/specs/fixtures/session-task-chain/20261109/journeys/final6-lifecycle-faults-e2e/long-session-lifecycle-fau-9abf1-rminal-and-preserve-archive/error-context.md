# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: long-session-lifecycle-faults.spec.ts >> real Host and Gateway owner receipts reclaim a generation-scoped terminal and preserve archive
- Location: tests\e2e\long-session-lifecycle-faults.spec.ts:173:5

# Error details

```
Error: expect(received).toMatch(expected)

Expected pattern: /workspace root/i
Received string:  "worktree owner read failed: ENOENT"
```

# Test source

```ts
  185 |     });
  186 |     const active = await hostInvoke<{
  187 |       activeWorkspace?: { id?: string };
  188 |       id?: string;
  189 |     }>(app, 'workspaces', 'getActive');
  190 |     const workspaceId = active.activeWorkspace?.id ?? active.id;
  191 |     if (!workspaceId) throw new Error('Active workspace has no id');
  192 |     let workspaceRoot = (active.activeWorkspace as { rootPath?: string } | undefined)?.rootPath;
  193 |     if (!workspaceRoot) {
  194 |       const listedWorkspaces = await hostInvoke<{
  195 |         activeWorkspace?: { id?: string; rootPath?: string };
  196 |         profiles?: Array<{ id?: string; rootPath?: string }>;
  197 |       }>(app, 'workspaces', 'list');
  198 |       workspaceRoot = listedWorkspaces.activeWorkspace?.rootPath ??
  199 |         listedWorkspaces.profiles?.find((profile) => profile.id === workspaceId)?.rootPath;
  200 |     }
  201 |     if (!workspaceRoot) throw new Error('Active workspace has no root path');    const created = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
  202 |       method: 'sessions.create',
  203 |       params: { agentId: 'main', label: 'resource-reclaim-' + Date.now() },
  204 |       timeoutMs: 60_000,
  205 |     });
  206 |     const sessionKey = typeof created.key === 'string'
  207 |       ? created.key
  208 |       : typeof created.sessionKey === 'string'
  209 |         ? created.sessionKey
  210 |         : null;
  211 |     if (!sessionKey) throw new Error(`sessions.create returned no key: ${JSON.stringify(created)}`);
  212 | 
  213 |     const listed = await listSessions(app);
  214 |     const sessionId = listed.sessions?.find((session) => session.key === sessionKey)?.sessionId;
  215 |     expect(sessionId).toBeTruthy();
  216 | 
  217 |     const opened = await hostInvoke<{
  218 |       success: boolean;
  219 |       error?: string;
  220 |       sessionId?: string;
  221 |       expectedSessionId?: string;
  222 |       status?: string;
  223 |     }>(app, 'terminal', 'open', {
  224 |       sessionKey,
  225 |       expectedSessionId: sessionId,
  226 |       keepOnLeave: true,
  227 |       cwd: workspaceRoot,
  228 |       command: 'echo agent-resource-probe',
  229 |     });
  230 |     expect(opened.success, opened.error).toBe(true);
  231 |     expect(opened.sessionId).toBeTruthy();
  232 |     expect(opened.expectedSessionId).toBe(sessionId);
  233 | 
  234 |     const stale = await hostInvoke<{ success: boolean; blocked?: boolean; reason?: string; expectedSessionId?: string }>(
  235 |       app,
  236 |       'terminal',
  237 |       'open',
  238 |       {
  239 |         sessionKey,
  240 |         expectedSessionId: 'stale-generation-e2',
  241 |         keepOnLeave: true,
  242 |         cwd: workspaceRoot,
  243 |       },
  244 |     );
  245 |     expect(stale.success).toBe(false);
  246 |     expect(stale.blocked).toBe(true);
  247 |     expect(stale.reason).toMatch(/generation changed/i);
  248 |     expect(stale.expectedSessionId).toBe(sessionId);
  249 | 
  250 |     const beforeStop = await hostInvoke<{
  251 |       success: boolean;
  252 |       snapshot: {
  253 |         session: { sessionId?: string | null };
  254 |         resources?: { owners: Array<{
  255 |           kind: string;
  256 |           authority: string;
  257 |           generation: string | null;
  258 |           state: string;
  259 |           count: number | null;
  260 |           activePermits: number | null;
  261 |           waiters: number | null;
  262 |           helperRefs: number | null;
  263 |           worktreeIds: string[] | null;
  264 |           detail?: string;
  265 |         }> };
  266 |       };
  267 |     }>(app, 'sessionActivity', 'snapshot', {
  268 |       workspaceId,
  269 |       sessionKey,
  270 |     });
  271 |     expect(beforeStop.success).toBe(true);
  272 |     expect(beforeStop.snapshot.session.sessionId).toBe(sessionId);
  273 |     expect(beforeStop.snapshot.resources?.owners).toEqual(expect.arrayContaining([
  274 |       expect.objectContaining({ kind: 'process', authority: 'managed', generation: sessionId }),
  275 |       expect.objectContaining({ kind: 'admission-permit', authority: 'managed', generation: sessionId, activePermits: 0, waiters: 0 }),
  276 |       expect.objectContaining({ kind: 'terminal', authority: 'managed', generation: sessionId, count: 1 }),
  277 |     ]));
  278 |     const worktreeOwner = beforeStop.snapshot.resources?.owners.find((owner) => owner.kind === 'worktree');
  279 |     expect(worktreeOwner === undefined).toBe(false);
  280 |     // A running turn can own a workspace from the coordinator/runtime context
  281 |     // that is not persisted on the session row yet. Unknown stay reported here;
  282 |     // deleting an unproven worktree is still forbidden.
  283 |     expect(['known', 'unknown']).toContain(worktreeOwner?.state);
  284 |     if (worktreeOwner?.state === 'unknown') {
> 285 |       expect(worktreeOwner.detail).toMatch(/workspace root/i);
      |                                    ^ Error: expect(received).toMatch(expected)
  286 |       expect(worktreeOwner.count).toBeNull();
  287 |     }
  288 |     expect(worktreeOwner?.generation).toBe(sessionId);
  289 | 
  290 |     const stopped = await hostInvoke<{
  291 |       success: boolean;
  292 |       stopped?: boolean;
  293 |       expectedSessionId?: string;
  294 |       resourceReclamation?: {
  295 |         action: string;
  296 |         recoveryRequired: boolean;
  297 |         keptOnLeave: number;
  298 |         owners: Array<{ kind: string; outcome: string; generation: string | null }>;
  299 |       };
  300 |     }>(app, 'sessions', 'stop', { sessionKey });
  301 |     expect(stopped.success).toBe(true);
  302 |     expect(stopped.stopped).toBe(true);
  303 |     expect(stopped.expectedSessionId).toBe(sessionId);
  304 |     expect(stopped.resourceReclamation?.action).toBe('run-cancel');
  305 |     expect(stopped.resourceReclamation?.recoveryRequired).toBe(false);
  306 |     // Session stop releases run admission but preserves user terminals, even\n    // when the main pre-run cleanup gate already closed a previous generation.\n    expect(stopped.resourceReclamation?.keptOnLeave).toBeGreaterThanOrEqual(0);
  307 |     expect(stopped.resourceReclamation?.owners).toEqual(expect.arrayContaining([
  308 |       expect.objectContaining({ kind: 'terminal', outcome: 'kept', generation: sessionId }),
  309 |       expect.objectContaining({ kind: 'admission-permit', outcome: 'not-owned', generation: sessionId }),
  310 |     ]));
  311 | 
  312 |     const afterStop = await hostInvoke<{
  313 |       success: boolean;
  314 |       snapshot: {
  315 |         resources?: { owners: Array<{ kind: string; count: number | null; activePermits: number | null; waiters: number | null }> };
  316 |       };
  317 |     }>(app, 'sessionActivity', 'snapshot', { sessionKey });
  318 |     expect(afterStop.success).toBe(true);
  319 |     expect(afterStop.snapshot.resources?.owners.find((owner) => owner.kind === 'admission-permit')).toMatchObject({
  320 |       activePermits: 0,
  321 |       waiters: 0,
  322 |     });
  323 |     expect(afterStop.snapshot.resources?.owners.find((owner) => owner.kind === 'terminal')?.count).toBe(0);
  324 | 
  325 |     const archived = await hostInvoke<{
  326 |       success: boolean;
  327 |       error?: string;
  328 |       resourceReclamation?: { action: string; recoveryRequired: boolean; keptOnLeave: number };
  329 |     }>(app, 'sessions', 'archive', {
  330 |       id: sessionKey,
  331 |       originalWorkspaceId: 'workspace-e2e',
  332 |     });
  333 |     expect(archived.success, archived.error).toBe(true);
  334 |     expect(archived.resourceReclamation?.action).toBe('session-archive');
  335 |     expect(archived.resourceReclamation?.recoveryRequired).toBe(false);
  336 |     // Archive mutates metadata only. A keep_on_leave terminal can be reclaimed\n    // only by a later explicit session delete; stop leaves it in place.\n    expect(archived.resourceReclamation?.keptOnLeave).toBeGreaterThanOrEqual(0);
  337 | 
  338 |     let stoppedAgain: { success: boolean; error?: string };
  339 |     try {
  340 |       stoppedAgain = await hostInvoke<{ success: boolean; error?: string }>(
  341 |         app,
  342 |         'sessions',
  343 |         'stop',
  344 |         { sessionKey },
  345 |       );
  346 |     } catch (error) {
  347 |       stoppedAgain = { success: false, error: error instanceof Error ? error.message : String(error) };
  348 |     }
  349 |     // The archive removed the coordinator row; a definitive runtime refusal is
  350 |     // recorded as such instead of fabricating a zero-permit cleanup.
  351 |     expect(stoppedAgain.success).toBe(false);
  352 |     expect(stoppedAgain.error).toMatch(/session not found/i);
  353 |     const receipt = {
  354 |       schema: 'clawx.long-session.real-owner-reclamation/v1',
  355 |       driven_by: 'agent',
  356 |       candidate: execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim(),
  357 |       actor: process.env.COMPASS_AGENT_NAME ?? 'clawx-e2e-agent',
  358 |       transport: 'built Electron host:invoke -> actual Gateway runtime -> Main owners',
  359 |       sessionKey,
  360 |       sessionId,
  361 |       terminal: {
  362 |         opened,
  363 |         staleGenerationRejected: stale.success === false && stale.blocked === true,
  364 |       },
  365 |       inventoryBeforeStop: beforeStop.snapshot.resources,
  366 |       stopped,
  367 |       inventoryAfterStop: afterStop.snapshot.resources,
  368 |       archived,
  369 |       stoppedAgain,
  370 |       recoveryRequired: Boolean(
  371 |         stopped.resourceReclamation?.recoveryRequired ||
  372 |         archived.resourceReclamation?.recoveryRequired,
  373 |       ),
  374 |       timestamp: new Date().toISOString(),
  375 |     };
  376 |     const output = testInfo.outputPath('owner-reclamation-receipt.json');
  377 |     await writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
  378 |     await testInfo.attach('owner-reclamation-receipt', { path: output, contentType: 'application/json' });
  379 |   } finally {
  380 |     await closeElectronApp(app);
  381 |   }
  382 | });
  383 | 
```