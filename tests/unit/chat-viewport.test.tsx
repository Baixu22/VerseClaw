import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { measureMessageWindow, useMessageViewport } from '../../src/hooks/use-message-viewport';

const items = Array.from({ length: 300 }, (_, index) => ({ key: 'm-' + index, index }));
const observers: Array<{ callback: ResizeObserverCallback; nodes: Set<Element> }> = [];
const originalObserver = globalThis.ResizeObserver;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(16), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  globalThis.ResizeObserver = class {
    record: typeof observers[number];
    constructor(callback: ResizeObserverCallback) { this.record = { callback, nodes: new Set() }; observers.push(this.record); }
    observe(node: Element) { this.record.nodes.add(node); }
    unobserve(node: Element) { this.record.nodes.delete(node); }
    disconnect() { this.record.nodes.clear(); }
  } as unknown as typeof ResizeObserver;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const parent = this.closest('[data-testid="scroll"]') as HTMLElement | null;
    const top = this.dataset.testid === 'scroll' ? 0 : -(parent?.scrollTop ?? 0) + Number.parseFloat(this.style.top || '0');
    return { top, bottom: top + 200, left: 0, right: 600, width: 600, height: 200, x: 0, y: top, toJSON: () => ({}) };
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? this.scrollTop; } });
});
afterEach(() => { observers.length = 0; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); globalThis.ResizeObserver = originalObserver; });

function View({ rows = items, session = 'session', position }: { rows?: typeof items; session?: string; position?: {scrollTop:number;messageKey?:string;offset?:number;pinned?:boolean} }) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const getScroller = useCallback(() => scroller, [scroller]);
  const { rows: mountedRows, offsets, total, start, attachList, measure, scrollToIndex } = useMessageViewport(rows, getScroller, session, 30, position);
  const attach = useCallback((node: HTMLDivElement | null) => {
      if (node) {
        Object.defineProperty(node, 'clientHeight', { configurable: true, value: 600 });
        Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => 64800 });
      }
      setScroller(node);
  }, []);
  return <><button onClick={() => scrollToIndex(250)}>jump</button>
    <div data-testid="scroll" ref={attach}>
      <div ref={attachList} style={{ height: total }}>
        {mountedRows.map((row, position) => <div key={row.key} ref={measure} data-viewport-key={row.key}
          data-testid={'row-' + row.index} style={{ position: 'absolute', top: offsets[start + position] }}>{row.index}</div>)}
      </div>
    </div></>;
}

describe('measured message viewport', () => {
  it('removes the estimated gap when a row becomes empty after process promotion', async () => {
    const view = render(<View rows={items.slice(0, 3)} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(32); });
    const row = screen.getByTestId('row-1');
    act(() => observers.forEach(observer => {
      if (observer.nodes.has(row)) observer.callback([{ target: row, borderBoxSize: [{ blockSize: 0 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    }));
    expect(screen.getByTestId('row-2').style.top).toBe('232px');
    view.unmount();
  });
  it('restores a saved message across session changes before and after measured heights arrive', async () => {
    const view=render(<View rows={items.slice(0,1)} session="child"/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(32);});
    view.rerender(<View rows={items} session="parent" position={{scrollTop:20000,messageKey:'m-100',offset:-15,pinned:false}}/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(32);});
    expect(screen.getByTestId('row-100')).toBeInTheDocument();
    const scroll=screen.getByTestId('scroll');expect(scroll.scrollTop).toBe(21615);
    const earlier=screen.getByTestId('row-98');
    act(()=>observers.forEach(observer=>{if(observer.nodes.has(earlier))observer.callback([
      {target:earlier,borderBoxSize:[{blockSize:400}]},{target:screen.getByTestId('row-100'),borderBoxSize:[{blockSize:200}]},
    ] as unknown as ResizeObserverEntry[],{} as ResizeObserver);}));
    expect(scroll.scrollTop).toBe(21815);view.unmount();
  });
  it('selects the actual offset of a tall row and never exceeds the existing row cap', () => {
    const heights = new Map([['m-0', 5000], ['m-1', 40]]);
    const first = measureMessageWindow(items, heights, 3000, 600, 12);
    expect(first.rows[0].index).toBe(0); expect(first.rows.length).toBeLessThanOrEqual(12);
    const middle = measureMessageWindow(items, heights, 10000, 600, 12);
    expect(middle.start).toBeGreaterThan(2); expect(middle.rows.length).toBeLessThanOrEqual(12);
  });
  it('mounts the requested old or new row and disconnects every observer on unmount', async () => {
    const view = render(<View />);
    await act(async () => { await vi.advanceTimersByTimeAsync(32); });
    expect(screen.getByTestId('row-0')).toBeInTheDocument();
    fireEvent.click(screen.getByText('jump'));
    await act(async () => { await vi.advanceTimersByTimeAsync(32); });
    expect(screen.getByTestId('row-250')).toBeInTheDocument();
    expect(screen.queryByTestId('row-0')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^row-/).length).toBeLessThanOrEqual(30);
    view.unmount(); expect(observers.every(observer => observer.nodes.size === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves the reading anchor after earlier rows grow or history is prepended', async () => {
    const view = render(<View />); fireEvent.click(screen.getByText('jump'));
    await act(async () => { await vi.advanceTimersByTimeAsync(32); });
    const scroll = screen.getByTestId('scroll'); const before = scroll.scrollTop;
    const row = screen.getByTestId('row-248');
    act(() => observers.forEach(observer => {
      if (observer.nodes.has(row)) observer.callback([{ target: row, borderBoxSize: [{ blockSize: 400 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    }));
    expect(scroll.scrollTop).toBe(before + 200);
    const prepended = [{ key: 'before-a', index: 0 }, { key: 'before-b', index: 1 }, ...items.map(item => ({ ...item, index: item.index + 2 }))];
    view.rerender(<View rows={prepended} />);
    expect(scroll.scrollTop).toBe(before + 200 + 432);
    view.unmount();
  });
  it('keeps a newly requested bottom position when a resize lands before the next frame', async () => {
    const view = render(<View />); fireEvent.click(screen.getByText('jump'));
    await act(async () => { await vi.advanceTimersByTimeAsync(32); });
    const scroll = screen.getByTestId('scroll');
    scroll.scrollTop = 64200; fireEvent.scroll(scroll);
    const row = screen.getByTestId('row-248');
    act(() => observers.forEach(observer => {
      if (observer.nodes.has(row)) observer.callback([{ target: row, borderBoxSize: [{ blockSize: 400 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(32); });
    expect(scroll.scrollTop).toBeGreaterThanOrEqual(64200);
    view.unmount();
  });
});
