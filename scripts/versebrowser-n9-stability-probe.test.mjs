import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { runProbe } from './versebrowser-n9-stability-probe.mjs';
import { cleanupBrowserProbe, ownsProbeCommandLine } from './lib/versebrowser-probe-cleanup.mjs';
import { browserBuildIdentity } from './lib/versebrowser-build-identity.mjs';
import { PROVENANCE_PATH, sha256 } from './lib/versebrowser-build-provenance.mjs';
import { recordBuildProvenance } from './versebrowser-build-provenance.mjs';

const require = createRequire(import.meta.url);
const asar = createRequire(require.resolve('electron-builder'))('@electron/asar');
async function syntheticPackage(root) {
  const app = join(root,'app'), runtime = join(root,'runtime'), resources = join(root,'package/resources');
  const inputs = [
    {archive:'app.asar',path:'dist/index.html',root:app},
    {archive:'app.asar',path:'dist-electron/main/index.js',root:app},
    {archive:'main-runtime.asar',path:'node_modules/@verse-claw/versebrowser/dist/engine/service.js',root:runtime},
  ];
  for (const input of inputs) {await mkdir(dirname(join(input.root,input.path)),{recursive:true});await writeFile(join(input.root,input.path),'synthetic fixture, never executed');}
  const proof = {schemaVersion:1,scope:'versebrowser-desktop-build-v1',status:'bound',driven_by:'agent',actor:'unit-fixture',sourceCommit:'a'.repeat(40),sourceTree:'b'.repeat(40),dirty:false,outputs:inputs.map(({archive,path})=>({archive,path,sha256:sha256('synthetic fixture, never executed')}))};
  await writeFile(join(app,PROVENANCE_PATH),JSON.stringify(proof)+'\n');
  await mkdir(resources,{recursive:true});
  await asar.createPackage(app,join(resources,'app.asar'));
  await asar.createPackage(runtime,join(resources,'main-runtime.asar'));
  const exe=join(root,'package/Verse Claw.exe');await writeFile(exe,'not executable');
  return {exe,app,runtime,resources};
}

test('census failures remain unknown and cannot skip owned directory reclamation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'verse-failed-census-'));
  await writeFile(join(root, 'owned.txt'), 'fixture');
  const result = await cleanupBrowserProbe({ runRoot: root, query: () => { throw new Error('census timeout'); } });
  assert.equal(result.runDirReclaimed, true);
  assert.equal(result.residualProcesses, null);
  assert.equal(result.appExited, false);
  assert.ok(result.errors.includes('census timeout'));
});

test('process ownership uses the complete user-data argument, not path substrings', () => {
  const root=resolve(tmpdir(),'owned probe');
  assert.equal(ownsProbeCommandLine(root,`"Verse Claw.exe" --user-data-dir="${join(root,'ud')}" --type=renderer`),true);
  assert.equal(ownsProbeCommandLine(root,`"--user-data-dir=${join(root,'ud')}"`),true);
  assert.equal(ownsProbeCommandLine(root,`type "${join(root,'ud','file.txt')}"`),false);
  assert.equal(ownsProbeCommandLine(root,`--user-data-dir="${join(root+'-sibling','ud')}"`),false);
  assert.equal(ownsProbeCommandLine(root,`--user-data-dir="${join(root,'ud-sibling')}"`),false);
  assert.equal(ownsProbeCommandLine('',`--user-data-dir="${join(root,'ud')}"`),false);
});

test('census failure retains the controller termination receipt and closes once', async () => {
  const root=await mkdtemp(join(tmpdir(),'verse-fallback-receipt-'));
  let closes=0;
  const app={close:async()=>{closes+=1;},process:()=>({pid:123,spawnfile:'Verse Claw.exe',kill:()=>true})};
  const result=await cleanupBrowserProbe({app,runRoot:root,interrupt:true,query:()=>{throw new Error('census failed');}});
  assert.equal(closes,1);
  assert.equal(result.killed,1);assert.equal(result.forcedShutdown,true);
  assert.equal(result.terminationRequests[0].backend,'controller-handle');
  assert.equal(result.terminationRequests[0].accepted,true);
  assert.equal(result.residualProcesses,null);assert.equal(result.appExited,false);
  assert.ok(result.errors.includes('census failed'));
  assert.ok(!result.errors.includes('Controlled interruption did not terminate an owned process'));
});

test('a transient census failure does not abandon the remaining cleanup observations', async () => {
  const root=await mkdtemp(join(tmpdir(),'verse-census-retry-'));
  let observations=0;
  const result=await cleanupBrowserProbe({runRoot:root,query:()=>{
    observations+=1;
    if(observations===1)return [{ProcessId:0,Name:'synthetic observation, never terminated'}];
    if(observations===2)throw new Error('transient census failure');
    return [];
  }});
  assert.ok(observations>=4);
  assert.equal(result.runDirReclaimed,true);assert.equal(result.residualProcesses,0);
  assert.ok(result.errors.includes('transient census failure'));
});

test('an interruption without an actual owned termination is not successful evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'verse-empty-interruption-'));
  const result = await cleanupBrowserProbe({ runRoot: root, interrupt: true, query: () => [] });
  assert.equal(result.runDirReclaimed, true);
  assert.equal(result.forcedShutdown, false);
  assert.ok(result.errors.includes('Controlled interruption did not terminate an owned process'));
});

test('a probe never sweeps another run from its shared temp root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'verse-probe-cleanup-'));
  try {
    const tempRoot = join(root, 'temp');
    await mkdir(join(tempRoot, 'n9-other-run'), { recursive: true });
    const sentinel = join(tempRoot, 'n9-other-run/keep.txt');
    await writeFile(sentinel, 'another run owns this');
    const owned = await mkdtemp(join(tempRoot,'n9-owned-'));
    const cleanup = await cleanupBrowserProbe({runRoot:owned,query:()=>[]});
    assert.equal(cleanup.runDirReclaimed,true);
    assert.equal(await readFile(sentinel, 'utf8'), 'another run owns this');
    assert.deepEqual(await readdir(tempRoot), ['n9-other-run']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('zero or invalid stability rounds cannot create a pass receipt', async () => {
  for (const count of [0,-1,NaN,0.5]) {
    const report=await runProbe({coldStarts:count,loops:0,interrupts:0});
    assert.equal(report.status,'fail');assert.equal(report.issues[0].kind,'invalid_round_counts');
  }
});

test('packaged output changes are detected against the embedded build proof', async () => {
  const root=await mkdtemp(join(tmpdir(),'verse-build-proof-'));
  try {
    const fixture=await syntheticPackage(root);
    assert.equal((await browserBuildIdentity(fixture.exe)).schemaVersion,2);
    await writeFile(join(fixture.runtime,'node_modules/@verse-claw/versebrowser/dist/engine/service.js'),'changed after build');
    await asar.createPackage(fixture.runtime,join(fixture.resources,'main-runtime.asar'));
    await assert.rejects(browserBuildIdentity(fixture.exe),/Packaged build output differs/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('an unrecorded browser copy in app.asar cannot escape compiled-output verification', async () => {
  const root=await mkdtemp(join(tmpdir(),'verse-build-mirror-'));
  try {
    const fixture=await syntheticPackage(root);
    const mirror=join(fixture.app,'node_modules/@verse-claw/versebrowser/dist/engine/service.js');
    await mkdir(dirname(mirror),{recursive:true});await writeFile(mirror,'unverified mirror');
    await asar.createPackage(fixture.app,join(fixture.resources,'app.asar'));
    await assert.rejects(browserBuildIdentity(fixture.exe),/Unrecorded packaged build output/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('the build seal rejects production source changed after capture', async () => {
  const root=await mkdtemp(join(tmpdir(),'verse-build-source-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true,encoding:'utf8'});
  try {
    await mkdir(join(root,'shared'),{recursive:true});
    await writeFile(join(root,'shared/contract.ts'),'export const value = 1;\n');
    await writeFile(join(root,'.gitignore'),'build/\ndist/\ndist-electron/\npackages/versebrowser/dist/\n');
    git('init','--initial-branch=main');git('add','.');git('-c','user.name=Agent fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
    await recordBuildProvenance(root,true);
    for(const file of ['dist/index.html','dist-electron/main/index.js','packages/versebrowser/dist/engine/service.js']) {
      await mkdir(dirname(join(root,file)),{recursive:true});await writeFile(join(root,file),'compiled fixture');
    }
    await writeFile(join(root,'packages/versebrowser/dist/engine/service.d.ts'),'export declare class Service {}');
    const proof=await recordBuildProvenance(root);
    assert.equal(proof.status,'bound');
    assert.ok(proof.outputs.some(output=>output.archive==='main-runtime.asar' && output.path.endsWith('/service.d.ts')));
    assert.ok(!proof.outputs.some(output=>output.archive==='app.asar' && output.path.endsWith('/service.d.ts')));
    assert.ok(proof.outputs.some(output=>output.archive==='app.asar' && output.path.endsWith('/service.js')));
    assert.equal(proof.outputs.length,5);
    for(const output of proof.outputs) {
      const content=output.path.endsWith('.d.ts')?'export declare class Service {}':'compiled fixture';
      assert.equal(output.sha256,sha256(content));
    }
    await writeFile(join(root,'shared/contract.ts'),'export const value = 2;\n');
    assert.equal((await recordBuildProvenance(root)).status,'source-changed-or-dirty');
    git('add','shared/contract.ts');git('-c','user.name=Agent fixture','-c','user.email=fixture@example.invalid','commit','-m','source changed');
    assert.equal((await recordBuildProvenance(root)).status,'source-changed-or-dirty');
  } finally {await rm(root,{recursive:true,force:true});}
});

test('both runners release the fixture and write failure evidence on initialization errors', async () => {
  const root=await mkdtemp(join(tmpdir(),'verse-init-failure-'));
  try {
    const fixture=await syntheticPackage(root);const invalidRoot=join(root,'not-a-directory');await writeFile(invalidRoot,'fixture');
    for (const runner of ['versebrowser-m10-packaged-flow-verify.mjs','versebrowser-n9-stability-probe.mjs']) {
      const output=join(root,runner+'.json');
      const result=spawnSync(process.execPath,[resolve('scripts',runner),'--exe',fixture.exe,'--temp-root',invalidRoot,'--output',output],{cwd:resolve('.'),encoding:'utf8',windowsHide:true,timeout:10000});
      assert.equal(result.error,undefined,`${runner} did not exit: ${result.error}`);
      assert.equal(result.status,1,result.stderr);
      const report=JSON.parse(await readFile(output,'utf8'));assert.equal(report.status,'fail');
      assert.notEqual(report.issues[0].kind,'build_identity_failed');
    }
  } finally {await rm(root,{recursive:true,force:true});}
});
