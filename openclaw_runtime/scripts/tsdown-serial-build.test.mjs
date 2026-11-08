import test from 'node:test';
import assert from 'node:assert/strict';
import { runSerialTsdownBuild, resolveTsdownBuildInvocation } from './tsdown-build.mjs';

test('explicit build heap retains hard container headroom and rejects invalid budgets',()=>{
  const base={platform:'win32',fs:{readFileSync(){throw new Error('not Linux');}},env:{OPENCLAW_BUILD_ALL_NO_PNPM:'1'}};
  assert.match(resolveTsdownBuildInvocation(base).options.env.NODE_OPTIONS,/8192/);
  const env={...base.env,OPENCLAW_TSDOWN_HEAP_MB:'12288'};
  assert.match(resolveTsdownBuildInvocation({...base,env}).options.env.NODE_OPTIONS,/12288/);
  assert.match(resolveTsdownBuildInvocation({...base,env,cgroupMemoryLimitBytes:6*1024**3}).options.env.NODE_OPTIONS,/5376/);
  assert.throws(()=>resolveTsdownBuildInvocation({...base,env:{...env,OPENCLAW_TSDOWN_HEAP_MB:'1024'}}),/2048/);
});

test('serial builds visit every configuration once without overlapping children',async()=>{
  const seen=[];let active=0;let peak=0;
  const result=await runSerialTsdownBuild({count:17,env:{TEMP:'D:/tmp'},resolveInvocation:input=>input,run:async input=>{
    active++;peak=Math.max(peak,active);assert.equal(input.env.OPENCLAW_BUILD_ALL_NO_PNPM,'1');assert.ok(!input.args.includes('--no-dts'));seen.push(Number(input.env.OPENCLAW_TSDOWN_CONFIG_INDEX));await Promise.resolve();active--;return {status:0,timedOut:false};
  }});
  assert.deepEqual(seen,Array.from({length:17},(_,i)=>i));assert.equal(peak,1);assert.equal(result.status,0);
});
test('serial builds retain the failing child exit and stop',async()=>{
  const seen=[];const result=await runSerialTsdownBuild({count:4,resolveInvocation:input=>input,run:async input=>{const i=Number(input.env.OPENCLAW_TSDOWN_CONFIG_INDEX);seen.push(i);return {status:i===1?124:0,timedOut:i===1};}});assert.equal(result.status,124);assert.deepEqual(seen,[0,1]);
});
test('serial builds preserve fatal import diagnostics from a zero exit',async()=>{
  const result=await runSerialTsdownBuild({count:3,resolveInvocation:input=>input,run:async()=>({status:0,fatalUnresolvedImport:'runtime dependency missing'})});assert.match(result.fatalUnresolvedImport,/runtime dependency/);
});
