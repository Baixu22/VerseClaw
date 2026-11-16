import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const scroll=vi.hoisted(()=>({scrollRef:Object.assign(vi.fn(),{current:null as HTMLElement|null}),contentRef:vi.fn(),stopScroll:vi.fn()}));
vi.mock('use-stick-to-bottom',()=>({useStickToBottom:()=>scroll}));
import { useStickToBottomInstant } from '../../src/hooks/use-stick-to-bottom-instant';
let frames:Map<number,FrameRequestCallback>,sequence:number,node:HTMLElement;
const flush=()=>act(()=>{const pending=[...frames];frames.clear();pending.forEach(([,callback])=>callback(0));});
beforeEach(()=>{
 frames=new Map();sequence=0;node=document.createElement('div');node.scrollTop=250;
 Object.defineProperty(node,'scrollHeight',{value:1000});scroll.scrollRef.current=node;vi.clearAllMocks();
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++sequence,callback);return sequence;});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
});
afterEach(()=>vi.unstubAllGlobals());
it('leaves a saved session position to the reading owner and stops library pinning',()=>{
 renderHook(()=>useStickToBottomInstant('session:generation',true,true));flush();flush();
 expect(scroll.stopScroll).toHaveBeenCalled();expect(node.scrollTop).toBe(250);
});
it('cancels an older visit second frame before restoring another session',()=>{
 const hook=renderHook(({key,preserve})=>useStickToBottomInstant(key,false,preserve),{initialProps:{key:'first',preserve:false}});
 flush();
 hook.rerender({key:'second',preserve:true});flush();
 expect(node.scrollTop).toBe(250);expect(node.style.visibility).toBe('');
});
