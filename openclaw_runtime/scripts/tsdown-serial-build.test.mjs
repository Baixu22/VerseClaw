import test from 'node:test';
import assert from 'node:assert/strict';
import { runSerialTsdownBuild } from './tsdown-build.mjs';

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
