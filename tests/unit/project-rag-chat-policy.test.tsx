import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedKnowledgeRead, knowledgeRequestKey } from '@/lib/knowledge-interaction';
import { UsedKnowledge } from '@/pages/Chat/UsedKnowledge';
import '@/i18n';
const { rpc, state }=vi.hoisted(()=>({rpc:vi.fn(),state:{sending:false,activeRunId:null as string|null}}));
vi.mock('@/lib/host-api',()=>({hostApi:{gateway:{rpc}}}));
vi.mock('@/stores/chat',()=>({useChatStore:(selector:(value:typeof state)=>unknown)=>selector(state)}));
afterEach(()=>{cleanup();vi.useRealTimers();rpc.mockReset();state.sending=false;state.activeRunId=null;});
describe('Project RAG interaction policy',()=>{
 it('keys the full query and independent scope/mode/profile identity',()=>{
  const key=knowledgeRequestKey('s','w','wiki','suggest','local','x'.repeat(200)+'a');
  expect(key).not.toBe(knowledgeRequestKey('s','w','wiki','suggest','local','x'.repeat(200)+'b'));
  expect(key).not.toBe(knowledgeRequestKey('s','w','wiki','suggest','quality','x'.repeat(200)+'a'));
  expect(key).not.toBe(knowledgeRequestKey('s2','w','wiki','suggest','local','x'.repeat(200)+'a'));
 });
 it('cancels optional reads and ignores late completion',async()=>{
  let finish!:(value:string)=>void;const request=new Promise<string>(resolve=>{finish=resolve});const controller=new AbortController();
  const reading=boundedKnowledgeRead(request,controller.signal,5000);controller.abort();
  expect(await reading).toEqual({reason:'cancelled'});finish('late');await Promise.resolve();
 });
 it('has a finite timeout and preserves a completed read',async()=>{
  vi.useFakeTimers();const controller=new AbortController();const reading=boundedKnowledgeRead(new Promise(()=>{}),controller.signal,5000);
  await vi.advanceTimersByTimeAsync(5000);expect(await reading).toEqual({reason:'timeout'});
  expect(await boundedKnowledgeRead(Promise.resolve('owner result'),controller.signal,5000)).toEqual({reason:'complete',result:'owner result'});
 });
 it('displays only retained references from the terminal DCS receipt',async()=>{
  rpc.mockResolvedValue({status:'ok',retainedEvidence:{schema:'RetainedEvidenceManifest/v1',units:[{citations:[{intentId:'retained',sourceRef:{subjectId:'kept.md'}}]}],retainedChars:400,estimatedTokens:100}});
  render(<UsedKnowledge runId="run-1" references={[{id:'retained',title:'Kept source',lookup:'kept.md'},{id:'dropped',title:'Budget dropped',lookup:'dropped.md'}]}/>);
  await waitFor(()=>expect(screen.getByTestId('chat-used-knowledge-sources')).toHaveTextContent('Kept source'));
  expect(screen.getByTestId('chat-used-knowledge-sources')).not.toHaveTextContent('Budget dropped');
  expect(rpc).toHaveBeenCalledWith('agent.wait',{runId:'run-1',timeoutMs:1000});
 });
 it('waits for the active run and marks a missing receipt explicitly',async()=>{
  state.sending=true;state.activeRunId='run-2';rpc.mockResolvedValue({status:'ok'});
  const result=render(<UsedKnowledge runId="run-2" references={[{id:'a',title:'A',lookup:'a.md'}]}/>);
  expect(rpc).not.toHaveBeenCalled();state.sending=false;state.activeRunId=null;
  await act(async()=>result.rerender(<UsedKnowledge runId="run-2" references={[{id:'a',title:'A',lookup:'a.md'}]}/>));
  await waitFor(()=>expect(screen.getByTestId('chat-used-knowledge')).toHaveTextContent('Usage receipt unavailable'));
 });
 it('does not count a dropped chunk from the same parent as retained',async()=>{
  rpc.mockResolvedValue({status:'ok',retainedEvidence:{schema:'RetainedEvidenceManifest/v1',units:[{citations:[{intentId:'kept-chunk',sourceRef:{subjectId:'shared.md'}}]}],retainedChars:40,estimatedTokens:10}});
  render(<UsedKnowledge runId="same-parent" references={[{id:'kept-chunk',title:'Kept chunk',lookup:'shared.md'},{id:'dropped-chunk',title:'Dropped chunk',lookup:'shared.md'}]}/>);
  await waitFor(()=>expect(screen.getByTestId('chat-used-knowledge')).toHaveTextContent('1 selected sources not retained'));
  expect(screen.getByTestId('chat-used-knowledge-sources')).toHaveTextContent('Kept chunk');
  expect(screen.getByTestId('chat-used-knowledge-sources')).not.toHaveTextContent('Dropped chunk');
 });
 it('keeps an ambiguous legacy selection comparison unavailable',async()=>{
  rpc.mockResolvedValue({status:'ok',retainedEvidence:{schema:'RetainedEvidenceManifest/v1',units:[{citations:[{refId:'legacy-source',sourceRef:{subjectId:'shared.md'}}]}],retainedChars:40,estimatedTokens:10}});
  render(<UsedKnowledge runId="legacy" references={[{id:'chunk-a',title:'A',lookup:'shared.md'},{id:'chunk-b',title:'B',lookup:'shared.md'}]}/>);
  await waitFor(()=>expect(screen.getByTestId('chat-used-knowledge')).toHaveTextContent('Selection comparison unavailable'));
  expect(screen.getByTestId('chat-used-knowledge')).not.toHaveTextContent('2 selected sources not retained');
 });
 it('retries a terminal publication race and displays zero retained evidence',async()=>{
  rpc.mockResolvedValueOnce({status:'timeout'}).mockResolvedValue({status:'ok',retainedEvidence:{schema:'RetainedEvidenceManifest/v1',units:[],retainedChars:0,estimatedTokens:0}});
  render(<UsedKnowledge runId="zero-run" references={[]} requestedCount={2}/>);
  await waitFor(()=>expect(screen.getByTestId('chat-used-knowledge')).toHaveTextContent('0 fragments'));
  expect(screen.getByTestId('chat-used-knowledge')).toHaveTextContent('2 selected sources not retained');
  expect(rpc).toHaveBeenCalledTimes(2);
 });
 it('retries an acknowledged terminal response until its manifest is published',async()=>{
  rpc.mockResolvedValueOnce({status:'ok'}).mockResolvedValue({status:'ok',retainedEvidence:{schema:'RetainedEvidenceManifest/v1',units:[],retainedChars:0,estimatedTokens:0}});
  render(<UsedKnowledge runId="published-later" references={[{id:'source',title:'Source',lookup:'source.md'}]}/>);
  await waitFor(()=>expect(screen.getByTestId('chat-used-knowledge')).toHaveTextContent('0 fragments'));
  expect(rpc).toHaveBeenCalledTimes(2);
 });
 it('ignores a late receipt after the owning run changes',async()=>{
  let finish!:(value:unknown)=>void;
  rpc.mockReturnValueOnce(new Promise(resolve=>{finish=resolve})).mockResolvedValue({status:'ok'});
  const view=render(<UsedKnowledge runId="old" references={[{id:'old',title:'Old source',lookup:'old.md'}]}/>);
  view.rerender(<UsedKnowledge runId="new" references={[{id:'new',title:'New source',lookup:'new.md'}]}/>);
  await waitFor(()=>expect(screen.getByTestId('chat-used-knowledge')).toHaveTextContent('Usage receipt unavailable'));
  await act(async()=>finish({status:'ok',retainedEvidence:{schema:'RetainedEvidenceManifest/v1',units:[{citations:[{intentId:'old',sourceRef:{subjectId:'old.md'}}]}],retainedChars:20,estimatedTokens:5}}));
  expect(screen.queryByTestId('chat-used-knowledge-sources')).not.toBeInTheDocument();
 });
});
