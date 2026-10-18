/**
 * TF-0102：snapshot 差异感知 —— 重复观察时只说"变了什么"，并让失效 ref 的报错
 * 提示重新观察，不把同名候选当作同一元素。
 *
 * 动机：真实任务 9 回合里模型 snapshot 了 3 次，其中一次还是点击超时后整页重读。
 * 默认输出保持不变（带 `diff: true` 才追加 `## Since last snapshot`），既有读数不动。
 * 无 Chromium 时 live 用例 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import type { AgentBrowserHostApi, AgentBrowserSnapshotItem } from '../src/types/host-api.ts';

type StubSnapshot = { snapshot: string; items: AgentBrowserSnapshotItem[] };

function snapText(options: {
  title: string;
  url: string;
  itemCount: number;
  htmlBytes: number;
  textChars: number;
}): string {
  return [
    '# snapshot',
    `- title: ${options.title}`,
    `- url: ${options.url}`,
    '',
    `## Interactive (${options.itemCount})`,
    '- (see items)',
    '',
    '## Metrics',
    `- html_bytes: ${options.htmlBytes}`,
    `- text_chars: ${options.textChars}`,
  ].join('\n');
}

function item(ref: string, role: string, name: string, href?: string): AgentBrowserSnapshotItem {
  return { ref, role, name, ...(href ? { href } : {}) };
}

/** Deterministic host: yields the given snapshots in order; click always fails. */
function stubApi(snapshots: StubSnapshot[]): AgentBrowserHostApi {
  let index = 0;
  const base = {
    takeSnapshot: async () => {
      const current = snapshots[Math.min(index, snapshots.length - 1)] as StubSnapshot;
      index += 1;
      return { success: true, snapshot: current.snapshot, items: current.items };
    },
    click: async () => {
      throw new Error('page.waitForSelector: Timeout 5000ms exceeded');
    },
    waitForSelector: async () => ({ success: true }),
    close: async () => ({ success: true }),
    note: async () => undefined,
  };
  return base as unknown as AgentBrowserHostApi;
}

async function createFacade(api: AgentBrowserHostApi): Promise<AgentBrowserFacade> {
  const root = await mkdtemp(join(tmpdir(), 'vb-diff-'));
  return new AgentBrowserFacade({ api, evidenceRoot: root });
}

describe('snapshot diff + stale-ref resolution (TF-0102)', () => {
  it('retains observations for every refused field action', async()=>{
    const observation={changed:'unknown',beforeUrl:'https://example.test',afterUrl:'https://example.test',sinceCursor:'field:1',networkObserved:0,scope:'session-window',businessOutcome:'unknown'};
    const refused=async()=>({success:false,error:'field refused',observation});
    const api={type:refused,pressKey:refused,selectOption:refused,setChecked:refused,selectValues:refused,appendText:refused} as unknown as AgentBrowserHostApi;
    const facade=await createFacade(api);
    for(const result of await Promise.all([facade.type('s','#f','x'),facade.pressKey('s','Enter'),facade.selectOption('s','#f','x'),facade.setChecked('s','#f',true),facade.selectValues('s','#f',['x']),facade.appendText('s','#f','x')])) {
      expect(result.ok).toBe(false);expect(result.error?.details).toMatchObject({observation:{sinceCursor:'field:1'},recovery:'observe-before-retry'});
    }
  });
  it('pointer and drag failures retain observed state without replay', async()=>{
    const observation={changed:'unknown',beforeUrl:'https://example.test/?token=PRIVATE',afterUrl:'https://example.test',sinceCursor:'epoch:3',networkObserved:0,scope:'session-window',businessOutcome:'unknown'};
    let calls=0;
    const api={pointer:async()=>{calls++;throw Object.assign(new Error('pointer failed'),{observation});},drag:async()=>{calls++;return {success:false,error:'drag failed',observation};}} as unknown as AgentBrowserHostApi;
    const facade=await createFacade(api);
    const results=[await facade.pointer({sessionId:'s',action:'hover',selector:'#a'}),await facade.drag({sessionId:'s',sourceSelector:'#a',targetSelector:'#b'})];
    for(const result of results){expect(result.ok).toBe(false);expect(result.error?.details).toMatchObject({observation:{sinceCursor:'epoch:3'},recovery:'observe-before-retry'});expect(JSON.stringify(result)).not.toContain('PRIVATE');}
    expect(calls).toBe(2);
  });
  it('rejects after waits on old hosts without making a call, while retaining ordinary clicks', async () => {
    const calls:string[]=[];
    const api={waitForSelector:async()=>{calls.push('wait');return {success:true};},click:async()=>{calls.push('click');return {success:true,session:{id:'s'}};}} as unknown as AgentBrowserHostApi;
    const facade=await createFacade(api);
    expect((await facade.click('s','#a',5000,'popup')).error?.code).toBe('E_NOT_IMPLEMENTED');
    expect((await facade.click('s','#a',5000,'invalid' as never)).error?.code).toBe('E_ARG');
    expect(calls).toEqual([]);
    expect((await facade.click('s','#a')).ok).toBe(true);
    expect(calls).toEqual(['wait','click']);
  });
  it('field results preserve host observation and distinguish target change from business outcome', async () => {
    const api={type:async()=>({success:true,session:{id:'s'},fieldChange:{before:{value:'a'},after:{value:'b'},changed:true},observation:{changed:true,beforeUrl:'https://example.test/?token=PRIVATE',afterUrl:'https://example.test/new',sinceCursor:'epoch:2',networkObserved:1,scope:'session-window',businessOutcome:'unknown'}})} as unknown as AgentBrowserHostApi;
    const result=await (await createFacade(api)).type('s','#field','b');
    expect(result.data).toMatchObject({fieldChange:{changed:true},observation:{sinceCursor:'epoch:2',businessOutcome:'unknown'}});
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('pointer and drag retain observations without inventing business success', async () => {
    let refuse = false;
    const api = {
      pointer: async () => refuse ? {success:false,error:'denied'} : {success:true,session:{id:'s'}},
      drag: async () => refuse ? {success:false,error:'denied'} : {success:true,session:{id:'s'},observation:{changed:true,beforeUrl:'https://example.test/?token=PRIVATE',afterUrl:'https://example.test/new',sinceCursor:'epoch:1',networkObserved:0,scope:'session-window',businessOutcome:'unknown'}},
    } as unknown as AgentBrowserHostApi;
    const facade = await createFacade(api);
    const pointer = await facade.pointer({sessionId:'s',action:'hover',selector:'#a'});
    expect(pointer.data).toMatchObject({observation:{changed:'unknown',businessOutcome:'unknown'}});
    const drag = await facade.drag({sessionId:'s',sourceSelector:'#a',targetSelector:'#b'});
    expect(drag.data).toMatchObject({observation:{changed:true,sinceCursor:'epoch:1',businessOutcome:'unknown'}});
    expect(JSON.stringify(drag)).not.toContain('PRIVATE');
    refuse=true;
    expect((await facade.pointer({sessionId:'s',action:'hover',selector:'#a'})).ok).toBe(false);
    expect((await facade.drag({sessionId:'s',sourceSelector:'#a',targetSelector:'#b'})).ok).toBe(false);
  });
  it('retains failed click observation without replay and redacts source URLs', async () => {
    let clicks=0;
    const observation={changed:'unknown',beforeUrl:'https://example.test/?token=PRIVATE',afterUrl:'https://example.test/end',sinceCursor:'epoch:3',networkObserved:1,scope:'session-window',businessOutcome:'unknown',events:[{type:'navigation'}]};
    const api={waitForSelector:async()=>({success:true}),click:async()=>{clicks++;throw Object.assign(new Error('action timed out'),{observation});}} as unknown as AgentBrowserHostApi;
    const result=await (await createFacade(api)).click('s','#target');
    expect(result.ok).toBe(false);expect(clicks).toBe(1);
    expect(result.error?.details).toMatchObject({recovery:'observe-before-retry',observation:{sinceCursor:'epoch:3',businessOutcome:'unknown'}});
    expect(result.error?.details).toMatchObject({recoveryHint:{category:'timeout',retryable:false,execution:'may_have_side_effects'}});
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('does not click after a host wait refusal or report a refused click as success', async () => {
    let clicks = 0;
    const api = { waitForSelector: async () => ({success:false,error:'wait refused'}), click: async () => { clicks++; return {success:false,error:'click refused'}; } } as unknown as AgentBrowserHostApi;
    const facade = await createFacade(api);
    const waitRefused = await facade.click('s','#target');
    expect(waitRefused.ok).toBe(false); expect(waitRefused.content).toContain('wait refused'); expect(clicks).toBe(0);
    api.waitForSelector = async () => ({success:true} as never);
    const clickRefused = await facade.click('s','#target');
    expect(clickRefused.ok).toBe(false); expect(clickRefused.content).toContain('click refused'); expect(clicks).toBe(1);
  });
  it('第一次没有基线；之后只报变化；没变就明说没变', async () => {
    const first: StubSnapshot = {
      snapshot: snapText({ title: 'Doc', url: 'https://example.test/a', itemCount: 1, htmlBytes: 100, textChars: 20 }),
      items: [item('e1', 'link', 'Home', '/')],
    };
    const second: StubSnapshot = {
      snapshot: snapText({ title: 'Doc', url: 'https://example.test/b', itemCount: 2, htmlBytes: 340, textChars: 52 }),
      items: [item('e1', 'link', 'Home', '/'), item('e2', 'button', 'Buy now')],
    };
    const facade = await createFacade(stubApi([first, second]));

    const noBaseline = await facade.snapshot('s-diff', { diff: true });
    expect(noBaseline.ok).toBe(true);
    expect(String(noBaseline.content)).toContain('first snapshot in this session');
    expect((noBaseline.data as { diff?: boolean }).diff).toBe(false);

    const changed = await facade.snapshot('s-diff', { diff: true });
    const text = String(changed.content);
    expect(text).toContain('## Since last snapshot');
    expect(text).toContain('- url: https://example.test/a -> https://example.test/b');
    expect(text).toContain('- metrics: html_bytes 100 -> 340, text_chars 20 -> 52');
    expect(text).toContain('- interactive: 1 -> 2 (+1 / -0)');
    expect(text).toContain('added: button | "Buy now"');

    const unchanged = await facade.snapshot('s-diff', { diff: true });
    expect(String(unchanged.content)).toContain('no observable change');
  });

  it('不加 diff 时输出与改动前一致（不追加任何差异段）', async () => {
    const only: StubSnapshot = {
      snapshot: snapText({ title: 'Doc', url: 'https://example.test/a', itemCount: 1, htmlBytes: 100, textChars: 20 }),
      items: [item('e1', 'link', 'Home', '/')],
    };
    const facade = await createFacade(stubApi([only, only]));
    const plain = await facade.snapshot('s-plain');
    expect(String(plain.content)).not.toContain('## Since last snapshot');
    expect(String(plain.content)).toContain('## Interactive (1)');
  });

  it('失效 ref 只建议唯一相似候选，不宣称身份相同', async () => {
    const before: StubSnapshot = {
      snapshot: snapText({ title: 'Doc', url: 'https://example.test/a', itemCount: 1, htmlBytes: 100, textChars: 20 }),
      items: [item('e1', 'button', 'Search')],
    };
    const after: StubSnapshot = {
      snapshot: snapText({ title: 'Doc', url: 'https://example.test/a', itemCount: 1, htmlBytes: 140, textChars: 22 }),
      items: [item('e7', 'button', 'Search')],
    };
    const facade = await createFacade(stubApi([before, after]));

    await facade.snapshot('s-stale');
    const clicked = await facade.click('s-stale', '[data-vb-ref="e1"]', 500);
    expect(clicked.ok).toBe(false);
    expect(String(clicked.error?.message)).toContain('ref "e1" could not be used');
    expect(String(clicked.error?.message)).toContain('similar candidate [data-vb-ref="e7"]');
    expect(String(clicked.error?.message)).toContain('identity is not confirmed');
    expect(String(clicked.error?.message)).not.toContain('is now');
  });

  it('失效ref的同名候选歧义不选择第一个，也不重放动作', async () => {
    const snapshot = snapText({ title: 'Doc', url: 'https://example.test/a', itemCount: 2, htmlBytes: 100, textChars: 20 });
    const api = stubApi([
      { snapshot, items: [item('e1', 'button', 'Save')] },
      { snapshot, items: [item('e7', 'button', 'Save'), item('e8', 'button', 'Save')] },
    ]);
    let clicks = 0;
    api.click = async () => { clicks++; throw new Error('E_STALE_REF'); };
    const facade = await createFacade(api);
    await facade.snapshot('s-ambiguous');
    const failed = await facade.click('s-ambiguous', '[data-vb-ref="e1"]');
    expect(failed.ok).toBe(false);
    expect(failed.error?.message).toContain('2 similar candidates; identity is ambiguous');
    expect(failed.error?.message).not.toContain('[data-vb-ref="e7"]');
    expect(failed.error?.message).not.toContain('[data-vb-ref="e8"]');
    expect(clicks).toBe(1);
  });

  it('live：DOM 变化后 diff 报出新增项', async () => {
    let api: AgentBrowserHostApi;
    try {
      api = await createPlaywrightHostApi();
    } catch {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const PAGE = `data:text/html,${encodeURIComponent('<!doctype html><html><body><a href="/">Home</a></body></html>')}`;
    const facade = await createFacade(api);
    const opened = await facade.open({ url: PAGE, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;

    try {
      await facade.snapshot(sessionId, { diff: true });
      await api.evaluate({
        sessionId,
        expression:
          "(() => { const b = document.createElement('button'); b.textContent = 'Late button'; document.body.appendChild(b); return true; })()",
      });
      const after = await facade.snapshot(sessionId, { diff: true });
      expect(String(after.content)).toContain('## Since last snapshot');
      expect(String(after.content)).toContain('added: button | "Late button"');
      expect((after.data as { diff?: boolean }).diff).toBe(true);
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);
});
