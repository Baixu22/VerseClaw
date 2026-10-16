/**
 * TF-0100：`vb_wait` —— 让页面先稳定再断言，而不是盲点重试。
 * 同时钉住真实任务里暴露的摩擦：ref 失效时的报错必须可行动。
 * 无 Chromium 时 SKIP，不红 CI。
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';
import { recoveryHint } from '../src/engine/navigation-errors.ts';

const PAGE = `data:text/html,${encodeURIComponent(`<!doctype html>
<html><body>
  <div id="root">loading</div>
  <button id="start" onclick="
    setTimeout(function () {
      document.getElementById('root').innerHTML = '<button id=late>ready</button>';
    }, 1500);
  ">start</button>
</body></html>`)}`;

async function tryFacade(): Promise<AgentBrowserFacade | null> {
  try {
    const api: AgentBrowserHostApi = await createPlaywrightHostApi();
    const root = await mkdtemp(join(tmpdir(), 'vb-wait-'));
    return new AgentBrowserFacade({ api, evidenceRoot: root });
  } catch {
    return null;
  }
}

describe('vb_wait (TF-0100)', () => {
  it('preserves read failure categories across SDK observation entrances',async()=>{
    const failure=Object.assign(new Error('Execution context was destroyed'),{code:'E_PAGE_CLOSED'});
    const read=vi.fn().mockRejectedValue(failure);
    const facade=new AgentBrowserFacade({api:{takeSnapshot:read,readForms:read,findElement:read,extractPageText:read} as unknown as AgentBrowserHostApi});
    for(const result of [await facade.snapshot('s'),await facade.readForms('s'),await facade.findElement({sessionId:'s',role:'button'}),await facade.extractPageText({sessionId:'s'})]) {
      expect(result.ok).toBe(false);
      expect(result.error?.details).toMatchObject({recoveryHint:{category:'closed',retryable:false,execution:'read_only'}});
    }
    expect(read).toHaveBeenCalledTimes(4);
    read.mockResolvedValue({success:false,error:'E_PAGE_CLOSED',snapshot:'stale content'});
    const failedSnapshot=await facade.snapshot('s');
    expect(failedSnapshot.ok).toBe(false);
    expect(failedSnapshot.error?.details).toMatchObject({recoveryHint:{category:'closed',retryable:false}});
  });
  it('keeps failed lifecycle calls failed and never advises navigation replay',async()=>{
    const navigate=vi.fn().mockResolvedValue({success:false,error:'E_PAGE_CLOSED',session:{id:'s',url:'https://example.test'}});
    const open=vi.fn().mockRejectedValue(Object.assign(new Error('timeout opening'),{recoverySessionId:'recovery'}));
    const facade=new AgentBrowserFacade({api:{navigate,open,getConsoleMessages:async()=>({success:true,content:''}),networkListRequests:async()=>({success:true,requests:[]})} as unknown as AgentBrowserHostApi});
    const failed=await facade.nav('s','https://example.test');
    expect(failed.ok).toBe(false);expect(failed.error?.details).toMatchObject({recoveryHint:{category:'closed',retryable:false}});
    navigate.mockRejectedValue(new Error('Execution context was destroyed'));
    const transient=await facade.nav('s','https://example.test');
    expect(transient.error?.details).toMatchObject({recoveryHint:{category:'navigation_transient',retryable:false,execution:'may_have_side_effects'}});
    const opened=await facade.open();
    expect(opened.error?.details).toMatchObject({recoverySessionId:'recovery',recoveryHint:{category:'timeout',retryable:false}});
    expect(recoveryHint(new Error('E_CANCELLED'),false)).toMatchObject({category:'cancelled',retryable:false});
    expect(navigate).toHaveBeenCalledTimes(2);expect(open).toHaveBeenCalledTimes(1);
  });
  it('compares scoped text exactly, including empty text, without treating missing nodes as changes',async()=>{
    const facade=await tryFacade();if(!facade)throw new Error('browser unavailable');
    const opened=await facade.open({url:`data:text/html,${encodeURIComponent('<div id="status">old</div><span class="same"></span><span class="same"></span><button onclick="document.querySelector(\'#status\').textContent=\'\'">Change</button>')}`});
    expect(opened.ok,opened.content).toBe(true);const sessionId=(opened.data as {session:{id:string}}).session.id;
    try {
      expect((await facade.wait({sessionId,selector:'#status',textEquals:'old'})).ok).toBe(true);
      expect((await facade.wait({sessionId,selector:'#status',textEquals:'ol',timeoutMs:30})).ok).toBe(false);
      expect((await facade.click(sessionId,'button')).ok).toBe(true);
      expect((await facade.wait({sessionId,selector:'#status',textEquals:''})).ok).toBe(true);
      expect((await facade.wait({sessionId,selector:'#status',textNotEquals:'old'})).ok).toBe(true);
      const ambiguous=await facade.wait({sessionId,selector:'.same',textEquals:''});
      expect(ambiguous.ok).toBe(false);expect(ambiguous.content).toContain('E_AMBIGUOUS_TARGET');
      expect((await facade.wait({sessionId,selector:'#missing',textNotEquals:'old',timeoutMs:30})).ok).toBe(false);
      expect((await facade.wait({sessionId,textEquals:''})).error?.code).toBe('E_ARG');
      expect((await facade.wait({sessionId,selector:'#status',textEquals:'',valueEquals:''})).error?.code).toBe('E_ARG');
    } finally {await facade.close(sessionId);await facade.dispose();}
  });
  it('bounds a host selector wait that ignores its timeout',async()=>{
    const waitForSelector=vi.fn(()=>new Promise<never>(()=>{}));
    const facade=new AgentBrowserFacade({api:{waitForSelector} as unknown as AgentBrowserHostApi});
    const result=await Promise.race([facade.wait({sessionId:'s',selector:'#missing',timeoutMs:30}),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('selector wait escaped deadline')),500))]);
    expect(result.ok).toBe(false);expect(result.content).toContain('timeout');expect(waitForSelector).toHaveBeenCalledTimes(1);
  });
  it('bounds a slow individual read probe by the total wait deadline',async()=>{
    let rejectLate!:(error:Error)=>void;
    const evaluate=vi.fn(()=>new Promise<never>((_,reject)=>{rejectLate=reject;}));
    const facade=new AgentBrowserFacade({api:{evaluate} as unknown as AgentBrowserHostApi});
    const result=await Promise.race([facade.wait({sessionId:'s',text:'ready',timeoutMs:30}),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('wait exceeded total deadline')),500))]);
    expect(result.ok).toBe(false);expect(result.content).toContain('timeout');expect(evaluate).toHaveBeenCalledTimes(1);
    rejectLate(new Error('late read failure'));
  });
  it('closing a session interrupts value waiting and cannot satisfy absence',async()=>{
    const facade=await tryFacade();if(!facade)throw new Error('browser unavailable');
    const opened=await facade.open({url:`data:text/html,${encodeURIComponent('<input id="field" value="old">')}`});
    expect(opened.ok,opened.content).toBe(true);const id=(opened.data as {session:{id:string}}).session.id;
    let finished=false;
    try {
      const pending=facade.wait({sessionId:id,selector:'#field',valueEquals:'new',timeoutMs:10000}).then(result=>{finished=true;return result;});
      await facade.close(id);
      await expect.poll(()=>finished,{timeout:2000}).toBe(true);
      expect((await pending).ok).toBe(false);
      const absent=await facade.wait({sessionId:id,selector:'#field',absent:true,timeoutMs:1000});
      expect(absent.ok).toBe(false);
    }finally{await facade.dispose();}
  });
  it('gives recovery advice without authorizing write replay',()=>{
    for(const code of ['E_FIELD_READONLY','E_TARGET_UNAVAILABLE'])expect(recoveryHint(new Error(code),false)).toMatchObject({category:'blocked',retryable:false,reobserve:true,needs_user:false});
    expect(recoveryHint(new Error('Execution context was destroyed'),true)).toMatchObject({category:'navigation_transient',retryable:true});
    expect(recoveryHint(new Error('Execution context was destroyed'),false).retryable).toBe(false);
    expect(recoveryHint(new Error('E_AFTER_TIMEOUT'),false)).toMatchObject({category:'timeout',retryable:false,reobserve:true,execution:'may_have_side_effects'});
    expect(recoveryHint(new Error('E_PAGE_CLOSED'),true)).toMatchObject({category:'closed',retryable:false});
    expect(recoveryHint(new Error('E_NEED_CONFIRM'),false)).toMatchObject({category:'needs_user',needs_user:true});
    expect(recoveryHint(new Error('E_AMBIGUOUS_TARGET'),true)).toMatchObject({category:'ambiguous',retryable:false,reobserve:true});
    expect(recoveryHint(Object.assign(new Error('timeout while requesting permission'),{code:'E_CAPABILITY_DENY'}),false)).toMatchObject({category:'denied',retryable:false});
    expect(recoveryHint(Object.assign(new Error('Execution context was destroyed'),{code:'E_CUSTOM_TERMINAL'}),true)).toMatchObject({category:'unknown',retryable:false});
  });
  it('waits for removal and explicit value changes, rejecting ambiguous fields',async()=>{
    const facade=await tryFacade(); if(!facade) throw new Error('browser unavailable');
    const page=`data:text/html,${encodeURIComponent('<div id="gone">remove me</div><input id="value" value="old"><input class="same"><input class="same"><button onclick="document.querySelector(\'#gone\').remove();document.querySelector(\'#value\').value=\'\'">Change</button>')}`;
    const opened=await facade.open({url:page});expect(opened.ok,opened.content).toBe(true);const id=(opened.data as {session:{id:string}}).session.id;
    try {
      expect((await facade.click(id,'button')).ok).toBe(true);
      expect((await facade.wait({sessionId:id,selector:'#gone',absent:true})).ok).toBe(true);
      expect((await facade.wait({sessionId:id,selector:'#value',valueEquals:''})).ok).toBe(true);
      expect((await facade.wait({sessionId:id,selector:'#value',valueNotEquals:'old'})).ok).toBe(true);
      const ambiguous=await facade.wait({sessionId:id,selector:'.same',valueEquals:''});expect(ambiguous.ok).toBe(false);expect(ambiguous.content).toContain('E_AMBIGUOUS_TARGET');
      expect((await facade.wait({sessionId:id,selector:'#missing',valueEquals:'',timeoutMs:20})).ok).toBe(false);
      expect((await facade.wait({sessionId:id,valueEquals:''})).error?.code).toBe('E_ARG');
    } finally {await facade.close(id);await facade.dispose();}
  });
  it('rejects failed observations and invalid deadlines without pretending the condition timed out', async () => {
    const waitForSelector=vi.fn().mockResolvedValue({success:false,error:'driver wait refused'});
    const evaluate=vi.fn().mockResolvedValue({success:false,error:'collection unavailable'});
    const facade=new AgentBrowserFacade({api:{waitForSelector,evaluate} as unknown as AgentBrowserHostApi});
    const selector=await facade.wait({sessionId:'s',selector:'#a'});
    expect(selector.ok).toBe(false);expect(selector.content).toContain('driver wait refused');
    const failed=await facade.wait({sessionId:'s',text:'x',timeoutMs:20});
    expect(failed.ok).toBe(false);expect(failed.content).toContain('collection unavailable');expect(evaluate).toHaveBeenCalledTimes(1);
    expect(failed.error?.details).toMatchObject({recoveryHint:{category:'collection_failed',retryable:false,reobserve:true}});
    for(const timeoutMs of [NaN,Infinity,-1,0])expect((await facade.wait({sessionId:'s',text:'x',timeoutMs})).error?.code).toBe('E_ARG');
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
  it('keeps waiting through navigation context replacement', async () => {
    const evaluate = vi.fn()
      .mockRejectedValueOnce(new Error('Execution context was destroyed, most likely because of a navigation'))
      .mockResolvedValue({ success: true, value: true });
    const facade = new AgentBrowserFacade({ api: { evaluate } as unknown as AgentBrowserHostApi });
    expect((await facade.wait({ sessionId: 's', text: 'Ready', timeoutMs: 1000 })).ok).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('does not retry an explicit terminal code whose message mentions navigation',async()=>{
    const evaluate=vi.fn().mockRejectedValue(Object.assign(new Error('Execution context was destroyed'),{code:'E_CUSTOM_TERMINAL'}));
    const facade=new AgentBrowserFacade({api:{evaluate} as unknown as AgentBrowserHostApi});
    const result=await facade.wait({sessionId:'s',text:'ready',timeoutMs:1000});
    expect(result.ok).toBe(false);expect(evaluate).toHaveBeenCalledTimes(1);
    expect(result.error?.details).toMatchObject({recoveryHint:{category:'unknown',retryable:false}});
  });

  it('uses the original deadline and does not retry a closed session', async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error('Cannot find context with specified id'));
    const facade = new AgentBrowserFacade({ api: { evaluate } as unknown as AgentBrowserHostApi });
    const result = await facade.wait({ sessionId: 's', text: 'Ready', timeoutMs: 80 });
    expect(result.ok).toBe(false);
    expect(result.content).toContain('timeout after 80ms');
    evaluate.mockClear().mockRejectedValue(new Error('Target page, context or browser has been closed'));
    const closed = await facade.wait({ sessionId: 's', text: 'Ready', timeoutMs: 5000 });
    expect(closed.ok).toBe(false);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('等待晚出现的元素 / 文本；超时与空条件给出可行动错误', async () => {
    const facade = await tryFacade();
    if (!facade) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const opened = await facade.open({ url: PAGE, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
    expect(sessionId).toBeTruthy();

    try {
      const waiting = facade.wait({ sessionId, selector: '#late', timeoutMs: 5_000 });
      expect((await facade.click(sessionId, '#start')).ok).toBe(true);
      const bySelector = await waiting;
      expect(bySelector.ok).toBe(true);
      // Arm the page timer after wait starts; a slow open cannot consume the
      // delay before the elapsed-time assertion begins.
      expect((bySelector.data as { elapsedMs?: number }).elapsedMs).toBeGreaterThanOrEqual(900);

      const byText = await facade.wait({ sessionId, text: 'ready', timeoutMs: 5_000 });
      expect(byText.ok).toBe(true);

      const timeout = await facade.wait({ sessionId, selector: '#never', timeoutMs: 400 });
      expect(timeout.ok).toBe(false);
      expect(timeout.error?.code).toBe('E_WAIT');
      expect(String(timeout.error?.message)).toContain('selector #never');
      // Assert the *bound*, not the leading digit of the elapsed time: the message
      // embeds measured wall-clock ms, so `toContain('waited 4')` flaked under
      // full-suite load as soon as the 400 ms wait overshot into the 500s.
      const waitedMs = Number(/waited (\d+)ms/u.exec(String(timeout.error?.message))?.[1] ?? Number.NaN);
      expect(Number.isFinite(waitedMs)).toBe(true);
      expect(waitedMs).toBeGreaterThanOrEqual(350);
      expect(waitedMs).toBeLessThan(5_000);

      const noCondition = await facade.wait({ sessionId });
      expect(noCondition.ok).toBe(false);
      expect(String(noCondition.error?.message)).toContain('at least one of');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  it('ref 失效的报错要说明"refs are per-snapshot"（click 与 wait 都是）', async () => {
    const facade = await tryFacade();
    if (!facade) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const opened = await facade.open({ url: PAGE, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
    expect(sessionId).toBeTruthy();

    try {
      const clicked = await facade.click(sessionId, '[data-vb-ref="e99"]', 300);
      expect(clicked.ok).toBe(false);
      expect(String(clicked.error?.message)).toContain('refs are per-snapshot');

      const waited = await facade.wait({
        sessionId,
        selector: '[data-vb-ref="e99"]',
        timeoutMs: 300,
      });
      expect(waited.ok).toBe(false);
      expect(String(waited.error?.message)).toContain('refs are per-snapshot');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);
});
