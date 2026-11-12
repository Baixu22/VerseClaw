import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeRunScope } from '../../shared/types/identity-scope';
import { createWorktreeService, resolveExecutionCheckout } from '../../openclaw_runtime/src/agents/worktree-service';
import { checkoutWriterSnapshot, releaseCheckoutWriter, settleCheckoutWrite, withCheckoutMaintenance, withAsyncCheckoutMaintenance } from '../../openclaw_runtime/src/agents/worktree-writer';
import * as registry from '../../openclaw_runtime/src/agents/worktree-registry';
import { filesystemInstance } from '../../openclaw_runtime/src/agents/worktree-registry';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { resolveExecutionStatePath } from '../../openclaw_runtime/src/state/execution-state-db';

function owner(name='one') {
 return {kind:'run' as const,agentId:'test-agent',sessionGeneration:'session-v1',bindingRevision:1,
  run:normalizeRunScope({runId:name,scope:{workspaceId:'workspace',projectId:'project',sessionKey:`agent:test:${name}`}})};
}
describe('checkout writer resource owner',()=>{
 let root:string;
 beforeEach(()=>{root=mkdtempSync(path.join(tmpdir(),'checkout-writer-'));vi.stubEnv('OPENCLAW_STATE_DIR',path.join(root,'state'));});
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();closeOpenClawStateDatabaseForTest();rmSync(root,{recursive:true,force:true});});
 function service(){return createWorktreeService(root);}
 it('shares the same execution owner when the source runtime isolates its session state',()=>{
  const hostPath=resolveExecutionStatePath();const s=service(),record=s.create('isolated-runtime');
  const writer=s.claimWriter(record.id,record.generation,owner(),'host-claim');
  vi.stubEnv('CLAWX_EXECUTION_STATE_PATH',hostPath);
  vi.stubEnv('OPENCLAW_STATE_DIR',path.join(root,'isolated-source-config'));
  closeOpenClawStateDatabaseForTest();
  const runtime=resolveExecutionCheckout(record.root);
  expect(runtime.service.writer(record.id)?.token).toBe(writer.token);
  runtime.service.beginWrite(writer,'effect','digest');
  runtime.service.settleWrite(writer,'effect',{outcome:'completed',ownerReceipt:'runtime-effect'});
  runtime.service.releaseWriter(writer);
  expect(s.writer(record.id)?.state).toBe('released');
 });
 it('releases a live pre-admission failure as not-applied without waiting for process exit',async()=>{
  const s=service();
  await expect(withAsyncCheckoutMaintenance([s.writerBasis(null)],'merge',async()=>{throw new Error('before-effect failure');},undefined,undefined,undefined,true)).rejects.toThrow('before-effect failure');
  expect(s.writer(null)?.state).toBe('released');
  expect(s.writer(null)?.operations.at(-1)).toMatchObject({effectPrepared:false,state:'settled',receipt:{outcome:'not-applied'}});
  const writer=s.claimWriter(null,s.writerBasis(null).generation,owner('after-preflight'),'after-preflight');s.releaseWriter(writer);
 });
 it('uses the same base writer for ordinary effects and maintenance',()=>{
  const {service:s,worktreeId,basis}=resolveExecutionCheckout(root);
  expect(worktreeId).toBeNull();
  const writer=s.claimWriter(worktreeId,basis.generation,owner(),'base-effect');
  expect(()=>s.withFrozenWorktrees([],()=>undefined)).toThrow(/writer_busy/);
  s.beginWrite(writer,'write','request-digest');
  writeFileSync(path.join(root,'base-result.txt'),'base owner result');
  s.settleWrite(writer,'write',{outcome:'completed',ownerReceipt:'task-effect:write'});
  s.releaseWriter(writer);
  expect(s.withFrozenWorktrees([],()=>readFileSync(path.join(root,'base-result.txt'),'utf8'))).toBe('base owner result');
 });
 it('resolves managed roots back to their persistent generation after restart',()=>{
  const s=service(),record=s.create('managed');
  closeOpenClawStateDatabaseForTest();
  const resolved=resolveExecutionCheckout(record.root);
  expect(resolved.worktreeId).toBe(record.id);
  expect(resolved.basis.generation).toBe(record.generation);
  const writer=resolved.service.claimWriter(resolved.worktreeId,resolved.basis.generation,owner(),'managed-effect');
  expect(()=>s.claimWriter(record.id,record.generation,owner('other'),'other')).toThrow(/writer_busy/);
  resolved.service.releaseWriter(writer);
 });
 it('does not reinterpret a failed managed registration as an independent checkout',()=>{
  const s=service(),record=s.create('incomplete');
  const state=registry.loadWorktreeRegistryScope(root);
  state.records.get(record.id)!.registration.phase='allocated';
  registry.saveWorktreeRegistryScope(state);
  expect(()=>resolveExecutionCheckout(record.root)).toThrow(/worktree_incomplete/);
 });
 it('rotates a drained writer without exposing the checkout to a competing task',()=>{
  const s=service(),record=s.create('transfer');
  const first=s.claimWriter(record.id,record.generation,owner('parent'),'parent-claim');
  expect(()=>s.transferWriter(first,owner('child'),'transfer')).toThrow(/requires_drain/);
  s.beginWrite(first,'parent-write','digest');s.drainWriter(first);
  expect(()=>s.transferWriter(first,owner('child'),'transfer')).toThrow(/operations_pending/);
  expect(()=>s.claimWriter(record.id,record.generation,owner('intruder'),'intruder')).toThrow(/writer_busy/);
  s.settleWrite(first,'parent-write',{outcome:'completed',ownerReceipt:'parent-tool-receipt'});
  const child=s.transferWriter(first,owner('child'),'transfer');
  expect(child.epoch).toBe(first.epoch+1);expect(child.token).not.toBe(first.token);
  expect(s.transferWriter(first,owner('child'),'transfer')).toEqual(child);
  expect(()=>s.beginWrite(first,'late','late')).toThrow(/stale_credential/);
  expect(()=>s.transferWriter(first,owner('intruder'),'transfer')).toThrow(/request_conflict/);
  expect(()=>s.claimWriter(record.id,record.generation,owner('intruder'),'intruder')).toThrow(/writer_busy/);
  s.releaseWriter(child);
 });
 it('retains captured task association in the resource identity across reopen',()=>{
  const s=service(),record=s.create('task');
  const taskOwner={...owner(),task:{authorityId:'authority',taskNodeId:'task-a',epoch:3,contractRevision:2}};
  const first=s.claimWriter(record.id,record.generation,taskOwner,'with-task');
  closeOpenClawStateDatabaseForTest();
  expect(s.writer(record.id)?.owner).toEqual(first.owner);
  expect(()=>s.claimWriter(record.id,record.generation,{...taskOwner,task:{...taskOwner.task,epoch:4}},'with-task')).toThrow(/request_conflict/);
 });
 function worker(input:{id:string;generation:string;owner:string;mode?:'crash'|'maintenance-prepare-crash'}) {
  const child=spawn(process.execPath,['--import','tsx',path.resolve('tests/unit/fixtures/checkout-writer-worker.mts'),Buffer.from(JSON.stringify({root,...input})).toString('base64')],
   {cwd:path.resolve('openclaw_runtime'),env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stderr.on('data',b=>stderr+=String(b));
  const exit=new Promise<number|null>((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
  const ready=new Promise<Record<string,unknown>>((resolve,reject)=>{child.stdout.on('data',b=>{stdout+=String(b);if(stdout.includes('\n'))resolve(JSON.parse(stdout.slice(0,stdout.indexOf('\n'))));});child.once('error',reject);child.once('exit',()=>{if(!stdout.includes('\n'))reject(new Error(stderr));});});
  return{child,exit,ready};
 }
 it('excludes a different writer and preserves exact request/owner/epoch identity',()=>{
  const s=service(),r=s.create('one');const a=s.claimWriter(r.id,r.generation,owner(),'claim');
  expect(s.claimWriter(r.id,r.generation,owner(),'claim')).toEqual(a);
  expect(()=>s.claimWriter(r.id,r.generation,owner('two'),'claim')).toThrow(/request_conflict/);
  expect(()=>s.claimWriter(r.id,r.generation,owner('two'),'second')).toThrow(/writer_busy/);
  expect(()=>s.beginWrite({...a,owner:owner('forged')},'write','digest')).toThrow(/stale_credential/);
  expect(()=>s.beginWrite({...a,owner:{...owner(),bindingRevision:2}},'write','digest')).toThrow(/stale_credential/);
  s.releaseWriter(a);const b=s.claimWriter(r.id,r.generation,owner('two'),'second');
  expect(b.epoch).toBe(a.epoch+1);expect(()=>s.beginWrite(a,'late','digest')).toThrow(/stale_credential/);
  s.releaseWriter(b);expect(()=>s.claimWriter(r.id,r.generation,owner(),'claim')).toThrow(/request_retired/);
 });
 it('normalizes service aliases and releases only unused claims when multi-root admission fails',()=>{
  const s=service(),r=s.create('one');const writer=s.claimWriter(r.id,r.generation,owner(),'claim');
  const alias=path.join(root,'alias');symlinkSync(root,alias,process.platform==='win32'?'junction':'dir');
  try{expect(()=>createWorktreeService(alias).claimWriter(r.id,r.generation,owner('two'),'other')).toThrow(/writer_busy/);}
  finally{rmSync(alias,{force:true,recursive:false});}
  expect(()=>withCheckoutMaintenance([{root,incarnation:filesystemInstance(root),generation:'base'},
   {root:r.root,incarnation:filesystemInstance(r.root),generation:r.generation}],'freeze',()=>{})).toThrow(/writer_busy/);
  const baseClaim=checkoutWriterSnapshot(root);expect(baseClaim===null||baseClaim.state==='released').toBe(true);
  expect(s.writer(r.id)?.epoch).toBe(writer.epoch);
 });
 it('persists in-flight and unknown effects across restart until an explicit owner receipt settles them',()=>{
  const s=service(),r=s.create('one'),a=s.claimWriter(r.id,r.generation,owner(),'claim');
  expect(s.beginWrite(a,'write','digest')).toEqual({state:'started'});
  closeOpenClawStateDatabaseForTest();
  expect(()=>s.releaseWriter(a)).toThrow(/operations_pending/);
  expect(()=>s.beginWrite(a,'write','digest')).toThrow(/outcome_pending/);
  s.settleWrite(a,'write',null);expect(s.writer(r.id)?.state).toBe('draining');
  expect(()=>s.cleanup(r.id)).toThrow(/writer_busy/);
  expect(()=>s.beginWrite(a,'next','digest')).toThrow(/not_active/);
  const receipt={outcome:'completed' as const,ownerReceipt:'native-write-receipt'};
  s.settleWrite(a,'write',receipt);s.settleWrite(a,'write',receipt);
  expect(()=>s.settleWrite(a,'write',{...receipt,ownerReceipt:'conflicting'})).toThrow(/receipt_conflict/);
  s.releaseWriter(a);s.releaseWriter(a);s.cleanup(r.id);expect(existsSync(r.root)).toBe(false);
 });
 it('replays a completed receipt without reauthorizing its effect and rejects operation payload drift',()=>{
  const s=service(),r=s.create('one'),a=s.claimWriter(r.id,r.generation,owner(),'claim');
  s.beginWrite(a,'write','digest');const receipt={outcome:'completed' as const,ownerReceipt:'saved'};
  s.settleWrite(a,'write',receipt);expect(s.beginWrite(a,'write','digest')).toEqual({state:'replayed',receipt});
  expect(()=>s.beginWrite(a,'write','different')).toThrow(/request_conflict/);
 });
 it('closes expired and draining admission without transferring ownership',()=>{
  const s=service(),r=s.create('one'),now=Date.now();const a=s.claimWriter(r.id,r.generation,owner(),'claim',now+1000);
  const clock=vi.spyOn(Date,'now').mockReturnValue(now+2000);
  expect(()=>s.beginWrite(a,'write','digest')).toThrow(/recovery_required/);
  expect(()=>s.claimWriter(r.id,r.generation,owner('two'),'second')).toThrow(/writer_busy/);
  clock.mockReturnValue(now-2000);expect(()=>s.beginWrite(a,'rollback','digest')).toThrow(/recovery_required/);
  clock.mockRestore();s.drainWriter(a);expect(()=>s.beginWrite(a,'write','digest')).toThrow(/not_active/);s.releaseWriter(a);
 });
 it('rejects a replaced checkout and keeps epochs monotonic after managed recreation',()=>{
  const s=service(),r=s.create('one'),a=s.claimWriter(r.id,r.generation,owner(),'claim');
  s.releaseWriter(a);s.cleanup(r.id);const next=s.create('one');const b=s.claimWriter(next.id,next.generation,owner('two'),'second');
  expect(b.epoch).toBeGreaterThan(a.epoch);expect(()=>s.beginWrite(a,'late','digest')).toThrow(/stale_generation/);
  renameSync(next.root,next.root+'-old');mkdirSync(next.root);writeFileSync(path.join(next.root,'keep.txt'),'keep');
  expect(()=>s.beginWrite(b,'write','digest')).toThrow(/replaced/);
  expect(()=>s.cleanup(next.id)).toThrow(/replaced/);expect(readFileSync(path.join(next.root,'keep.txt'),'utf8')).toBe('keep');
 });
 it('gates real service merge, freeze and cleanup before filesystem effects',async()=>{
  const s=service();writeFileSync(path.join(root,'a.txt'),'base');const r=s.create('one',{writeSet:['a.txt'],seedFiles:['a.txt']});
  writeFileSync(path.join(r.root,'a.txt'),'worker');const writer=s.claimWriter(r.id,r.generation,owner(),'claim');
  s.enqueueMerge({worktreeId:r.id,worktreeGeneration:r.generation,changedFiles:['a.txt']});
  await expect(s.processMergeQueue()).rejects.toThrow(/writer_busy/);expect(readFileSync(path.join(root,'a.txt'),'utf8')).toBe('base');
  const freeze=vi.fn();expect(()=>s.withFrozenWorktrees([{worktreeId:r.id,worktreeGeneration:r.generation}],freeze)).toThrow(/writer_busy/);expect(freeze).not.toHaveBeenCalled();
  expect(()=>s.cleanup(r.id)).toThrow(/reconciliation_required/);
  s.releaseWriter(writer);expect((await s.processMergeQueue())[0].status).toBe('merged');expect(readFileSync(path.join(root,'a.txt'),'utf8')).toBe('worker');
  expect(s.withFrozenWorktrees([{worktreeId:r.id,worktreeGeneration:r.generation}],()=>42)).toBe(42);
  s.cleanup(r.id);expect(existsSync(r.root)).toBe(false);
 });
 it('retains failed maintenance and does not free or replay an unknown filesystem effect',()=>{
  const basis={root,incarnation:filesystemInstance(root),generation:'base'};
  expect(()=>withCheckoutMaintenance([basis],'merge',()=>{throw new Error('copy interrupted');})).toThrow('copy interrupted');
  const record=checkoutWriterSnapshot(root)!;expect(record.state).toBe('draining');
  expect(()=>withCheckoutMaintenance([basis],'merge',()=>{})).toThrow(/writer_busy/);
  settleCheckoutWrite(record,record.operations[0].id,{outcome:'not-applied',ownerReceipt:'owner-inspected-no-writes'});
  releaseCheckoutWriter(record);expect(withCheckoutMaintenance([basis],'merge',()=>42)).toBe(42);
 });
 it('finishes only its interrupted cleanup after native removal and permits a new incarnation',()=>{
  const s=service(),r=s.create('one');
  const original=registry.saveWorktreeRegistryScope;
  const fail=vi.spyOn(registry,'saveWorktreeRegistryScope').mockImplementation(scope=>{
    if(scope.records.get(r.id)?.status==='cleaned')throw new Error('result commit interrupted');
    original(scope);
  });
  expect(()=>s.cleanup(r.id)).toThrow('result commit interrupted');fail.mockRestore();
  expect(existsSync(r.root)).toBe(false);expect(s.writer(r.id)?.state).toBe('draining');
  closeOpenClawStateDatabaseForTest();s.cleanup(r.id);
  const next=s.create(r.id);const writer=s.claimWriter(next.id,next.generation,owner(),'next');
  expect(writer.generation).not.toBe(r.generation);expect(writer.epoch).toBeGreaterThan(1);
 });
 it('serializes competing processes while different native checkouts keep independent writers',async()=>{
  const s=service(),a=s.create('a'),b=s.create('b');const first=worker({id:a.id,generation:a.generation,owner:'first'});
  const children=[first];
  try {
   expect((await first.ready).ok).toBe(true);
   const contenders=Array.from({length:3},(_,i)=>worker({id:a.id,generation:a.generation,owner:`contender-${i}`}));
   children.push(...contenders);
   for(const c of contenders){const result=await c.ready;expect(result,JSON.stringify(result)).toMatchObject({ok:false,error:expect.stringContaining('writer_busy')});expect(await c.exit).toBe(0);}
   const parallel=worker({id:b.id,generation:b.generation,owner:'parallel'});children.push(parallel);expect((await parallel.ready).ok).toBe(true);parallel.child.stdin.end('release\n');expect(await parallel.exit).toBe(0);
   first.child.stdin.end('release\n');expect(await first.exit).toBe(0);
  }finally{for(const child of children)if(child.child.exitCode===null&&child.child.signalCode===null)child.child.kill();await Promise.all(children.map(child=>child.exit));}
 });
 it('retains a crashed native writer and rejects a new process instead of stealing its lease',async()=>{
  const s=service(),r=s.create('one');const child=worker({id:r.id,generation:r.generation,owner:'crashed',mode:'crash'});
  expect((await child.ready).ok).toBe(true);child.child.stdin.end('crash\n');expect(await child.exit).toBe(23);
  closeOpenClawStateDatabaseForTest();expect(s.writer(r.id)?.operations[0].state).toBe('running');
  expect(()=>s.claimWriter(r.id,r.generation,owner('next'),'next')).toThrow(/writer_busy/);
  expect(()=>s.cleanup(r.id)).toThrow(/writer_busy/);
 });
 it('recovers an exited maintenance reservation that never admitted a filesystem operation',async()=>{
  const s=service(),r=s.create('one');writeFileSync(path.join(r.root,'retained.txt'),'retained');
  const child=worker({id:r.id,generation:r.generation,owner:'prepared',mode:'maintenance-prepare-crash'});
  expect(await child.ready).toMatchObject({ok:true,phase:'prepared'});expect(await child.exit).toBe(23);
  closeOpenClawStateDatabaseForTest();
  expect(s.writer(r.id)).toMatchObject({state:'active',operations:[]});expect(readFileSync(path.join(r.root,'retained.txt'),'utf8')).toBe('retained');
  expect(()=>s.cleanup(r.id)).toThrow('worktree_cleanup_user_content_present');
  expect(readFileSync(path.join(r.root,'retained.txt'),'utf8')).toBe('retained');
  rmSync(path.join(r.root,'retained.txt'));
  // The original native lock owner exited; the new call uses its standard recovery.
  s.cleanup(r.id);expect(existsSync(r.root)).toBe(false);expect(s.list()[0].status).toBe('cleaned');
 });
 it('checks managed Git native identity in addition to directory instance',()=>{
  const git=(...args:string[])=>execFileSync('git',['-C',root,...args],{windowsHide:true,stdio:'pipe'});
  git('init','-q');writeFileSync(path.join(root,'a.txt'),'a');git('add','a.txt');git('-c','user.name=Agent','-c','user.email=agent@example.invalid','-c','commit.gpgsign=false','commit','-qm','base');
  const s=createWorktreeService(root,{backend:'git'}),r=s.create('native'),a=s.claimWriter(r.id,r.generation,owner(),'native-claim');
  expect(s.inspectIsolation(r.id,r.generation).status).toBe('verified');s.beginWrite(a,'write','digest');
  writeFileSync(path.join(r.root,'a.txt'),'new');s.settleWrite(a,'write',{outcome:'completed',ownerReceipt:'file-owner:sha'});s.releaseWriter(a);
  expect(s.writer(r.id)?.state).toBe('released');
 });
});

// driven_by: agent; requested_route: ccs-workbuddy/deepseek-v4.1-flash
// These cases use local Git objects/refs and the real cleanup owner; no network push.
describe('U5 committed checkout retention', () => {
  let fixtureRoot: string;
  let fixtureParent: string;
  let base: string;
  let facts: Record<string, unknown>;
  const content = 'Unpublished work retained by Git\n';
  const lifecycle = { agentId: 'u5-agent', sessionKey: 'agent:u5:cleanup', expectedSessionId: 'u5-generation' };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {
    cwd, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const refs = (head: string) => git(base, 'for-each-ref', `--contains=${head}`, '--format=%(refname)', 'refs/');
  const fileHash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  function commit(root: string) {
    writeFileSync(path.join(root, 'unpublished.txt'), content);
    git(root, 'add', 'unpublished.txt');
    git(root, 'commit', '-qm', 'unpublished local work');
    const head = git(root, 'rev-parse', 'HEAD');
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(git(root, 'remote')).toBe('');
    facts.commit = { head, clean: true, remotes: [], sha256: fileHash(path.join(root, 'unpublished.txt')) };
    return head;
  }
  beforeEach(() => {
    fixtureParent = process.env.U5_WORKTREE_EVIDENCE_DIR ?? tmpdir();
    mkdirSync(fixtureParent, { recursive: true });
    fixtureRoot = mkdtempSync(path.join(fixtureParent, 'u5-cleanup-'));
    base = path.join(fixtureRoot, 'repository');
    mkdirSync(base);
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_CONFIG_COUNT',
      'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) vi.stubEnv(key, undefined);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_CONFIG_GLOBAL', process.platform === 'win32' ? 'NUL' : '/dev/null');
    vi.stubEnv('GIT_TERMINAL_PROMPT', '0');
    vi.stubEnv('OPENCLAW_STATE_DIR', path.join(fixtureRoot, 'state'));
    vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', '');
    vi.stubEnv('CLAWX_VERSGIT_CLEANUP_ROOT', '');
    vi.stubEnv('CLAWX_VERSGIT_BINDING_ENABLED', '0');
    git(base, 'init', '-q', '-b', 'main');
    git(base, 'config', 'user.name', 'U5 agent fixture');
    git(base, 'config', 'user.email', 'u5@example.invalid');
    git(base, 'config', 'commit.gpgsign', 'false');
    git(base, 'config', 'core.hooksPath', process.platform === 'win32' ? 'NUL' : '/dev/null');
    writeFileSync(path.join(base, '.gitignore'), '.openclaw/\n');
    git(base, 'add', '.gitignore'); git(base, 'commit', '-qm', 'base');
    facts = { driven_by: 'agent', requested_route: 'ccs-workbuddy/deepseek-v4.1-flash',
      git: git(base, '--version'), baseHead: git(base, 'rev-parse', 'HEAD'), externalPush: false };
  });
  afterEach(({ task }) => {
    const cleanupRoot = path.resolve(fixtureRoot), cleanupParent = path.resolve(fixtureParent);
    if (!cleanupRoot.startsWith(cleanupParent + path.sep)) {
      closeOpenClawStateDatabaseForTest(); vi.unstubAllEnvs();
      throw new Error('Fixture cleanup escaped its parent');
    }
    try {
      const evidenceDir = process.env.U5_WORKTREE_EVIDENCE_DIR;
      if (evidenceDir) writeFileSync(path.join(evidenceDir, task.name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0,150) + '.json'),
        JSON.stringify({ ...facts, case: task.name, stateAtCleanup: task.result?.state,
          errors: task.result?.errors?.map(error => error.message) ?? [] }, null, 2) + '\n');
    } finally {
      closeOpenClawStateDatabaseForTest(); vi.unstubAllEnvs();
      rmSync(cleanupRoot, { recursive: true, force: true });
    }
  });

  it('retains an unpushed local branch and recreates its checkout after cleanup', () => {
    const service = createWorktreeService(base, { backend: 'git' });
    const row = service.create('branch');
    git(row.root, 'switch', '-c', 'u5-unpushed');
    const head = commit(row.root);
    expect(head).not.toBe(row.baseOid);
    facts.before = { baseOid: row.baseOid, head, refs: refs(head) };
    service.cleanup(row.id);
    expect(existsSync(row.root)).toBe(false);
    expect(git(base, 'rev-parse', 'refs/heads/u5-unpushed')).toBe(head);
    const recovered = path.join(fixtureRoot, 'recovered');
    git(base, 'worktree', 'add', recovered, 'u5-unpushed');
    expect(readFileSync(path.join(recovered, 'unpublished.txt'), 'utf8')).toBe(content);
    facts.after = { checkoutRemoved: true, retainedRef: 'refs/heads/u5-unpushed', head: git(recovered, 'rev-parse', 'HEAD'),
      recoveredFileSha256: fileHash(path.join(recovered, 'unpublished.txt')), registry: service.list()[0].status };
  });

  it('refuses a detached exclusive commit across owner reopen and lifecycle cleanup then allows a retained branch', () => {
    let service = createWorktreeService(base, { backend: 'git' });
    const row = service.create('detached', { owner: { ...lifecycle, retention: 'delete' } });
    const head = commit(row.root);
    expect(head).not.toBe(row.baseOid);
    expect(git(row.root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
    expect(refs(head)).toBe('');
    facts.before = { head, baseOid: row.baseOid, containingRefs: refs(head) };
    let error = '';
    try { service.cleanup(row.id); } catch (cause) { error = String(cause); }
    facts.firstAttempt = { error, pathExists: existsSync(row.root), record: service.list()[0].status };
    expect(error).toContain(`worktree_cleanup_unreferenced_commit:${head}`);
    expect(readFileSync(path.join(row.root, 'unpublished.txt'), 'utf8')).toBe(content);
    expect(service.writer(row.id)).toMatchObject({ state: 'released', operations: [] });
    closeOpenClawStateDatabaseForTest();
    service = createWorktreeService(base, { backend: 'git' });
    const receipt = service.cleanupOwned(lifecycle);
    facts.lifecycleReceipt = receipt;
    expect(receipt).toMatchObject({ attempted: 1, reclaimed: 0, failed: 1 });
    expect(service.list()[0]).toMatchObject({ generation: row.generation, status: 'active' });
    expect(git(row.root, 'rev-parse', 'HEAD')).toBe(head);
    // The explicit recovery action uses the existing Git ref owner.
    git(base, 'branch', 'u5-retained', head);
    service.cleanup(row.id);
    expect(existsSync(row.root)).toBe(false);
    expect(git(base, 'show', 'refs/heads/u5-retained:unpublished.txt')).toBe(content.trim());
    facts.recovered = { head, retainedRef: 'refs/heads/u5-retained', commitContent: git(base, 'show', 'refs/heads/u5-retained:unpublished.txt'),
      checkoutRemoved: true, registry: service.list()[0].status };
  });

  it.each(['main', 'remote-tracking', 'shared-ref'] as const)('allows detached cleanup when %s retains the commit', (kind) => {
    const service = createWorktreeService(base, { backend: 'git' });
    const row = service.create('reachable');
    const head = commit(row.root);
    const retainedRef = kind === 'main' ? 'refs/heads/main' : kind === 'remote-tracking' ? 'refs/remotes/proof/main' : 'refs/agent-retention/proof';
    if (kind === 'main') git(base, 'merge', '--ff-only', head);
    else git(base, 'update-ref', retainedRef, head);
    // remote-tracking is a locally seeded Git ref, not a claim that an external push occurred.
    facts.before = { head, baseOid: row.baseOid, containingRefs: refs(head), refFixture: kind };
    expect(refs(head)).toContain(retainedRef);
    service.cleanup(row.id);
    expect(existsSync(row.root)).toBe(false);
    expect(git(base, 'rev-parse', retainedRef)).toBe(head);
    expect(git(base, 'show', `${retainedRef}:unpublished.txt`)).toBe(content.trim());
    facts.after = { checkoutRemoved: true, retainedRef, head: git(base, 'rev-parse', retainedRef),
      content: git(base, 'show', `${retainedRef}:unpublished.txt`) };
  });

  it('does not treat a worktree-local ref as persistent retention', () => {
    const service = createWorktreeService(base, { backend: 'git' });
    const row = service.create('local-ref');
    const head = commit(row.root);
    git(row.root, 'update-ref', 'refs/worktree/temporary', head);
    git(base, 'update-ref', 'refs/worktree/temporary', head);
    facts.before = { head, containingRefs: refs(head) };
    let error = '';
    try { service.cleanup(row.id); } catch (cause) { error = String(cause); }
    facts.after = { error, pathExists: existsSync(row.root) };
    expect(error).toContain('worktree_cleanup_unreferenced_commit');
    expect(readFileSync(path.join(row.root, 'unpublished.txt'), 'utf8')).toBe(content);
  });

  it('keeps the dirty-content guard ahead of cleanup even with a retained commit', () => {
    const service = createWorktreeService(base, { backend: 'git' });
    const row = service.create('dirty');
    writeFileSync(path.join(row.root, 'unsaved.txt'), 'keep dirty work');
    expect(() => service.cleanup(row.id)).toThrow('worktree_cleanup_user_content_present:unsaved.txt');
    expect(readFileSync(path.join(row.root, 'unsaved.txt'), 'utf8')).toBe('keep dirty work');
    expect(service.list()[0].status).toBe('active');
    facts.after = { error: 'worktree_cleanup_user_content_present:unsaved.txt', pathExists: existsSync(row.root),
      head: git(row.root, 'rev-parse', 'HEAD'), dirty: git(row.root, 'status', '--porcelain'), fileSha256: fileHash(path.join(row.root, 'unsaved.txt')) };
  });

  it('cleans an untouched detached checkout retained by main', () => {
    const service = createWorktreeService(base, { backend: 'git' });
    const row = service.create('base-only');
    expect(git(row.root, 'rev-parse', 'HEAD')).toBe(row.baseOid);
    service.cleanup(row.id);
    expect(existsSync(row.root)).toBe(false);
    expect(service.list()[0].status).toBe('cleaned');
    facts.after = { checkoutRemoved: true, retainedRef: 'refs/heads/main', baseOid: row.baseOid,
      retainedHead: git(base, 'rev-parse', 'refs/heads/main') };
  });
});
