// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEventListeners } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ResourceFabric, type FabricLease } from '../../electron/services/resource-fabric';
import { resetResourceEnvelopeLedgerForTest } from '../../openclaw_runtime/src/resources/resource-envelope';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); resetResourceEnvelopeLedgerForTest(); });
afterEach(() => { vi.useRealTimers(); resetResourceEnvelopeLedgerForTest(); });
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
async function fillHost(fabric: ResourceFabric) {
  return Promise.all(Array.from({ length: 64 }, (_, i) => fabric.acquire('workspaceExec', `held-${i}`, { tenant: 'busy' })));
}

describe('integrated host budget and bounded waiting', () => {
  it('contracts all cross-workspace admission under one-percent free memory and wakes it after fresh recovery', async () => {
    const fabric = new ResourceFabric();
    fabric.observePressure({ machineMemory: { sampledAt: Date.now(), availablePhysicalBytes: 1, totalPhysicalBytes: 100 } });
    const held: FabricLease[] = [];
    const requests = Array.from({ length: 64 }, (_, i) => fabric.acquire('workspaceExec', `pressured-${i}`).then(lease => { held.push(lease); return lease; }));
    await flush();
    const totals = () => Object.values(fabric.getDiagnostics().accounts).reduce((total, account) => ({ active: total.active + account.active, queued: total.queued + account.queued }), { active: 0, queued: 0 });
    expect(totals()).toEqual({ active: 1, queued: 63 });
    vi.setSystemTime(Date.now() + 1000);
    fabric.observePressure({ machineMemory: { sampledAt: Date.now(), availablePhysicalBytes: 30, totalPhysicalBytes: 100 } });
    vi.setSystemTime(Date.now() + 10_000);
    fabric.observePressure({ machineMemory: { sampledAt: Date.now(), availablePhysicalBytes: 30, totalPhysicalBytes: 100 } });
    await Promise.all(requests);
    expect(totals()).toEqual({ active: 64, queued: 0 });
    held.forEach(lease => lease.release());
    expect(totals()).toEqual({ active: 0, queued: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('classifies 200 cross-workspace requests within the host cap and releases every wait resource', async () => {
    const fabric=new ResourceFabric();
    const controllers=Array.from({length:200},()=>new AbortController());
    const outcomes:Array<{id:number;status:string}>=[];
    let peakActive=0,peakQueued=0;
    const sample=()=>{
      const accounts=Object.values(fabric.getDiagnostics().accounts);
      peakActive=Math.max(peakActive,accounts.reduce((sum,a)=>sum+a.active,0));
      peakQueued=Math.max(peakQueued,...accounts.map(a=>a.queued));
    };
    const requests=controllers.map((controller,id)=>{
      const request=fabric.acquire('workspaceExec',`cross-${id}`,{tenant:`tenant-${id%8}`,signal:controller.signal,deadline:Date.now()+(id>=100&&id<116?15:10_000)})
        .then(async lease=>{sample();await new Promise(resolve=>setTimeout(resolve,50));lease.release();sample();outcomes.push({id,status:'success'});},error=>{
          outcomes.push({id,status:error.name==='AbortError'?'cancelled':String(error.code).includes('TIMEOUT')?'timeout':error.code==='RESOURCE_QUEUE_FULL'?'rejected':'unexpected'});sample();
        });
      sample();return request;
    });
    for(let id=70;id<86;id++)controllers[id].abort();
    await vi.runAllTimersAsync();await Promise.all(requests);
    const counts=Object.fromEntries(['success','cancelled','timeout','rejected','unexpected'].map(status=>[status,outcomes.filter(o=>o.status===status).length]));
    const accounts=Object.values(fabric.getDiagnostics().accounts);
    const final={active:accounts.reduce((sum,a)=>sum+a.active,0),queued:accounts.reduce((sum,a)=>sum+a.queued,0),timers:vi.getTimerCount(),listeners:controllers.reduce((sum,c)=>sum+getEventListeners(c.signal,'abort').length,0)};
    expect(counts).toEqual({success:168,cancelled:16,timeout:16,rejected:0,unexpected:0});
    expect(new Set(outcomes.map(o=>o.id)).size).toBe(200);expect(peakActive).toBe(64);expect(peakQueued).toBeLessThanOrEqual(64);
    expect(final).toEqual({active:0,queued:0,timers:0,listeners:0});
    if(process.env.RESOURCE_BUDGET_REPORT_DIR)writeFileSync(join(process.env.RESOURCE_BUDGET_REPORT_DIR,'cross-workspace-pressure.json'),JSON.stringify({driven_by:'agent',actor:'codex',requests:200,counts,peak:{active:peakActive,queuedPerAccount:peakQueued},final,outcomes},null,2)+'\n');
  });
  it('prefers a less-used tenant at equal QoS when global capacity is released', async () => {
    const fabric = new ResourceFabric(); const held = await fillHost(fabric);
    const order: string[] = []; const granted: FabricLease[] = [];
    const waiting = ['busy','new'].map(tenant => fabric.acquire('workspaceExec', `pending-${tenant}`, { tenant, qos: 'interactive' })
      .then(lease => { order.push(tenant); granted.push(lease); return lease; }));
    try {
      held[0].release(); await flush();
      expect(order).toEqual(['new']);
      expect(Object.values(fabric.getDiagnostics().accounts).reduce((n,a) => n+a.active,0)).toBe(64);
    } finally {
      held.forEach(l => l.release()); (await Promise.all(waiting)).forEach(l => l.release());
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses a zero-length queue when only the global owner is saturated', async () => {
    const fabric = new ResourceFabric({ accounts: { workspaceExec: { queueLength: 0 } } });
    const held=await fillHost(fabric);
    try {
      await expect(fabric.acquire('workspaceExec','overflow')).rejects.toMatchObject({ code: 'RESOURCE_QUEUE_FULL' });
      expect(fabric.getDiagnostics().accounts['workspaceExec:overflow']).toMatchObject({ active: 0, queued: 0, queueLimit: 0 });
    } finally { held.forEach(l=>l.release()); }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires and cancels global waiters without reserving capacity and rebuilds the live cap', async () => {
    const fabric = new ResourceFabric(); const held=await fillHost(fabric); const c=new AbortController();
    const expired=fabric.acquire('workspaceExec','expired',{ deadline: Date.now()+10 }).catch(e=>e);
    const cancelled=fabric.acquire('workspaceExec','cancelled',{ signal:c.signal }).catch(e=>e);
    const next=fabric.acquire('workspaceExec','next');
    c.abort(); await vi.advanceTimersByTimeAsync(10);
    expect(await expired).toMatchObject({ code:'TERMINAL_RESOURCE_LEASE_TIMEOUT' });
    expect(await cancelled).toMatchObject({ name:'AbortError' });
    expect(getEventListeners(c.signal,'abort')).toHaveLength(0);
    resetResourceEnvelopeLedgerForTest();
    held[0].release(); const lease=await next;
    expect(Object.values(fabric.getDiagnostics().accounts).reduce((n,a)=>n+a.active,0)).toBe(64);
    lease.release();held.forEach(l=>l.release());
    expect(Object.values(fabric.getDiagnostics().accounts).reduce((n,a)=>n+a.active+a.queued,0)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
