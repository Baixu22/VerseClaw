// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {runSerialTsdownBuild} from '../../openclaw_runtime/scripts/tsdown-build.mjs';

describe('full serial runtime build plan',()=>{
  it('visits every configuration in order and never runs two children at once',async()=>{
    const seen:number[]=[];let active=0;let peak=0;
    const result=await runSerialTsdownBuild({count:17,env:{TEMP:'D:/tmp'},resolveInvocation:(input)=>input,run:async(input)=>{active++;peak=Math.max(peak,active);expect(input.env.OPENCLAW_BUILD_ALL_NO_PNPM).toBe('1');expect(input.args).not.toContain('--no-dts');seen.push(Number(input.env.OPENCLAW_TSDOWN_CONFIG_INDEX));await Promise.resolve();active--;return {status:0,timedOut:false};}});
    expect(seen).toEqual(Array.from({length:17},(_,i)=>i));expect(peak).toBe(1);expect(result.status).toBe(0);
  });
  it('retains child failure and stops before building later configurations',async()=>{
    const seen:number[]=[];const result=await runSerialTsdownBuild({count:4,resolveInvocation:(input)=>input,run:async(input)=>{const i=Number(input.env.OPENCLAW_TSDOWN_CONFIG_INDEX);seen.push(i);return {status:i===1?124:0,timedOut:i===1};}});expect(result.status).toBe(124);expect(seen).toEqual([0,1]);
  });
  it('retains fatal import diagnostics even when the child exits zero',async()=>{
    const result=await runSerialTsdownBuild({count:3,resolveInvocation:(input)=>input,run:async()=>({status:0,fatalUnresolvedImport:'runtime dependency missing'})});expect(result.fatalUnresolvedImport).toContain('runtime dependency');
  });
});
