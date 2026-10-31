import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { barPath, niceTicks, pieSlices, sliceGeometry } from '@/components/tool-ui/chart/chart-geometry';
import { ChartView, type ChartData } from '@/components/tool-ui/chart/chart-view';
import { AgentInteractionRenderer, parseToolUiContent } from '@/components/tool-ui/agent-interactions';
import { projectMessageRender } from '@/pages/Chat/message-render-projection';

function fence(payload: Record<string, unknown>): string {
  return ['```tool-ui', JSON.stringify(payload), '```'].join('\n');
}

function parseChart(payload: Record<string, unknown>) {
  const { interactions } = parseToolUiContent(fence({ type: 'chart', ...payload }));
  return interactions[0];
}

const base = { labels: ['Q1', 'Q2', 'Q3'], series: [{ name: 'Revenue', data: [10, 20, 30] }] };

function marks(kind: string): Element[] {
  return Array.from(document.querySelectorAll(`[data-chart-mark="${kind}"]`));
}

function renderChart(chart: Partial<ChartData> & Pick<ChartData, 'chartType'>) {
  return render(<ChartView chart={{ labels: base.labels, series: base.series, ...chart }} />);
}

describe('parseChart', () => {
  it.each([
    [{ chartType: 'line' }, 'line'],
    [{ chartType: 'area' }, 'area'],
    [{ chartType: 'pie' }, 'pie'],
    [{ chartType: 'bar' }, 'bar'],
    [{ chart_type: 'line' }, 'line'],
    [{ chart_type: 'area' }, 'area'],
    [{ variant: 'pie' }, 'pie'],
    [{ chartType: 'column' }, 'bar'],
    [{ chartType: 'doughnut' }, 'pie'],
    [{ chartType: 'LINE' }, 'line'],
    [{}, 'bar'],
  ])('reads %j as %s', (fields, expected) => {
    expect(parseChart({ ...base, ...fields })).toMatchObject({ type: 'chart', chartType: expected });
  });

  it('refuses to draw an unknown type as something else', () => {
    expect(parseChart({ ...base, chartType: 'scatter' })).toMatchObject({
      chartType: 'unsupported',
      requestedType: 'scatter',
    });
  });

  it('keeps values aligned with their labels when an entry is bad', () => {
    expect(parseChart({
      labels: ['A', 'B', 'C'],
      series: [{ data: [1, 'oops', 3] }],
    })).toMatchObject({ series: [{ data: [1, null, 3] }] });
  });

  it('accepts numeric strings and alternate series keys', () => {
    expect(parseChart({
      labels: ['A', 2],
      series: [{ label: 'S', values: ['1.5', 2] }],
    })).toMatchObject({ labels: ['A', '2'], series: [{ name: 'S', data: [1.5, 2] }] });
  });

  it('pads short series and truncates long ones to the labels', () => {
    expect(parseChart({ labels: ['A', 'B'], series: [{ data: [1] }, { data: [1, 2, 3] }] })).toMatchObject({
      series: [{ data: [1, null] }, { data: [1, 2] }],
    });
  });

  it('drops a series with nothing in it', () => {
    const chart = parseChart({ labels: ['A'], series: [{ name: 'Empty', data: [] }, { name: 'Full', data: [1] }] });
    expect(chart).toMatchObject({ series: [{ name: 'Full' }] });
  });

  it.each([
    [{ labels: [], series: [{ data: [1] }] }],
    [{ labels: ['A'], series: [] }],
    [{ labels: ['A'], series: [{ data: [] }] }],
    [{ labels: ['A'], series: [{ data: ['x', null] }] }],
  ])('rejects %j, which reaches the fallback card rather than raw JSON', (payload) => {
    const source = fence({ type: 'chart', title: 'Broken', ...payload });
    const projection = projectMessageRender(
      { role: 'assistant', content: source },
      { isUser: false, suppressAssistantText: false, suppressToolCards: false },
    );
    expect(projection.toolUiInteractions).toEqual([]);
    expect(projection.displayText).toBe('');
    expect(projection.resources).toEqual([expect.objectContaining({ kind: 'unknown', type: 'chart', title: 'Broken' })]);
  });
});

describe('ChartView draws the declared type', () => {
  it('bar: columns and no line', () => {
    renderChart({ chartType: 'bar' });
    expect(screen.getByTestId('chat-tool-ui-chart')).toHaveAttribute('data-chart-type', 'bar');
    expect(marks('bar')).toHaveLength(3);
    expect(marks('line')).toHaveLength(0);
    expect(marks('area')).toHaveLength(0);
    expect(marks('slice')).toHaveLength(0);
  });

  it('line: a stroke with no fill, and no columns', () => {
    renderChart({ chartType: 'line' });
    expect(marks('line')).toHaveLength(1);
    expect(marks('line')[0]).toHaveAttribute('fill', 'none');
    expect(marks('line')[0]).toHaveAttribute('stroke-width', '2');
    expect(marks('bar')).toHaveLength(0);
    expect(marks('area')).toHaveLength(0);
    expect(marks('dot')).toHaveLength(3);
  });

  it('area: a translucent fill under a line', () => {
    renderChart({ chartType: 'area' });
    expect(marks('area')).toHaveLength(1);
    expect(marks('area')[0]).toHaveAttribute('fill-opacity', '0.1');
    expect(marks('line')).toHaveLength(1);
    expect(marks('bar')).toHaveLength(0);
  });

  it('pie: slices of the whole', () => {
    renderChart({ chartType: 'pie' });
    expect(marks('slice')).toHaveLength(3);
    expect(marks('bar')).toHaveLength(0);
    expect(marks('line')).toHaveLength(0);
    expect(screen.getByTestId('chat-chart-legend')).toHaveTextContent('Q1');
  });

  it('pie: a single value is a whole disc', () => {
    renderChart({ chartType: 'pie', labels: ['Only'], series: [{ data: [5] }] });
    expect(marks('slice')).toHaveLength(1);
    expect(marks('slice')[0]?.getAttribute('d')).toContain('A');
  });

  it('pie: skips zero slices but keeps them in the legend', () => {
    renderChart({ chartType: 'pie', labels: ['A', 'B'], series: [{ data: [5, 0] }] });
    expect(marks('slice')).toHaveLength(1);
    expect(screen.getByTestId('chat-chart-legend')).toHaveTextContent('B');
  });
});

describe('ChartView with multiple series', () => {
  const series = [{ name: 'North', data: [1, 2, 3] }, { name: 'South', data: [3, 2, 1] }];

  it('groups bars and adds a legend', () => {
    renderChart({ chartType: 'bar', series });
    expect(marks('bar')).toHaveLength(6);
    expect(screen.getByTestId('chat-chart-legend')).toHaveTextContent('North');
    expect(screen.getByTestId('chat-chart-legend')).toHaveTextContent('South');
  });

  it('draws one line per series', () => {
    renderChart({ chartType: 'line', series });
    expect(marks('line')).toHaveLength(2);
  });

  it('colours by series, not by rank', () => {
    renderChart({ chartType: 'line', series });
    expect(marks('line').map((mark) => mark.getAttribute('stroke'))).toEqual(['var(--chart-1)', 'var(--chart-2)']);
  });

  it('gives no legend box to a single series', () => {
    renderChart({ chartType: 'bar' });
    expect(screen.queryByTestId('chat-chart-legend')).toBeNull();
    expect(screen.getByTestId('chat-tool-ui-chart')).toHaveTextContent('Revenue');
  });

  it('draws a pie per series', () => {
    renderChart({ chartType: 'pie', series });
    expect(screen.getAllByTestId('chat-chart-plot')).toHaveLength(2);
    expect(marks('slice')).toHaveLength(6);
  });

  it('names unnamed series', () => {
    renderChart({ chartType: 'line', series: [{ data: [1, 2, 3] }, { data: [3, 2, 1] }] });
    expect(screen.getByTestId('chat-chart-legend')).toHaveTextContent('toolUi.chart.seriesFallback');
  });

  it('breaks a line at a missing value instead of inventing one', () => {
    renderChart({ chartType: 'line', series: [{ data: [1, null, 3] }] });
    expect(marks('line')).toHaveLength(2);
    expect(marks('dot')).toHaveLength(2);
  });

  it('marks an isolated point even in a dense series', () => {
    const labels = Array.from({ length: 20 }, (_, index) => `L${index}`);
    const data = labels.map((_, index) => (index === 10 ? 5 : null));
    renderChart({ chartType: 'line', labels, series: [{ data }] });
    expect(marks('dot')).toHaveLength(1);
  });

  it('draws negative bars from the zero baseline', () => {
    renderChart({ chartType: 'bar', series: [{ data: [10, -10, 5] }] });
    expect(marks('bar')).toHaveLength(3);
  });

  it('draws nothing for a zero bar rather than a misleading sliver', () => {
    renderChart({ chartType: 'bar', series: [{ data: [10, 0, 5] }] });
    expect(marks('bar')).toHaveLength(2);
  });
});

describe('ChartView degrades instead of misdrawing', () => {
  function expectTableOnly() {
    expect(screen.getByTestId('chat-chart-notice')).toBeInTheDocument();
    expect(screen.getByTestId('chat-chart-table')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-chart-plot')).toBeNull();
    expect(screen.queryByTestId('chat-chart-table-toggle')).toBeNull();
  }

  it('shows a table for an unsupported type', () => {
    renderChart({ chartType: 'unsupported', requestedType: 'scatter' });
    expectTableOnly();
  });

  it('shows a table for negative pie values', () => {
    renderChart({ chartType: 'pie', series: [{ data: [5, -1, 2] }] });
    expectTableOnly();
  });

  it('shows a table for an all-zero pie', () => {
    renderChart({ chartType: 'pie', series: [{ data: [0, 0, 0] }] });
    expectTableOnly();
  });

  it('shows a table past the series cap rather than generating colours', () => {
    const series = Array.from({ length: 9 }, (_, index) => ({ name: `S${index}`, data: [1, 2, 3] }));
    renderChart({ chartType: 'line', series });
    expectTableOnly();
  });

  it('shows a table past the pie slice cap', () => {
    const labels = Array.from({ length: 9 }, (_, index) => `L${index}`);
    renderChart({ chartType: 'pie', labels, series: [{ data: labels.map(() => 1) }] });
    expectTableOnly();
  });
});

describe('ChartView values stay reachable', () => {
  it('offers a data table for every drawn chart', () => {
    renderChart({ chartType: 'line' });
    const toggle = screen.getByTestId('chat-chart-table-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('chat-chart-table')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const table = screen.getByTestId('chat-chart-table');
    expect(table).toHaveTextContent('Q2');
    expect(table).toHaveTextContent('20');
  });

  it('shows a missing value as a dash, not zero', () => {
    renderChart({ chartType: 'bar', series: [{ data: [1, null, 3] }] });
    fireEvent.click(screen.getByTestId('chat-chart-table-toggle'));
    expect(screen.getByTestId('chat-chart-table')).toHaveTextContent('–');
  });

  it('shows every series in the tooltip on hover, with a crosshair on lines', () => {
    renderChart({ chartType: 'line', series: [{ name: 'North', data: [1, 2, 3] }, { name: 'South', data: [4, 5, 6] }] });
    fireEvent.pointerMove(document.querySelector('[data-chart-hit="1"]')!);

    const tooltip = screen.getByTestId('chat-chart-tooltip');
    expect(tooltip).toHaveTextContent('Q2');
    expect(tooltip).toHaveTextContent('North');
    expect(tooltip).toHaveTextContent('South');
    expect(tooltip).toHaveTextContent('5');
    expect(marks('crosshair')).toHaveLength(1);
  });

  it('has no crosshair on bars', () => {
    renderChart({ chartType: 'bar' });
    fireEvent.pointerMove(document.querySelector('[data-chart-hit="0"]')!);
    expect(screen.getByTestId('chat-chart-tooltip')).toHaveTextContent('10');
    expect(marks('crosshair')).toHaveLength(0);
  });

  it('gives keyboard users the same details', () => {
    renderChart({ chartType: 'bar' });
    const plot = screen.getByTestId('chat-chart-plot');
    expect(plot).toHaveAttribute('tabindex', '0');

    fireEvent.focus(plot);
    expect(screen.getByTestId('chat-chart-tooltip')).toHaveTextContent('Q1');
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(screen.getByTestId('chat-chart-tooltip')).toHaveTextContent('Q2');
    fireEvent.keyDown(plot, { key: 'End' });
    expect(screen.getByTestId('chat-chart-tooltip')).toHaveTextContent('Q3');
    fireEvent.keyDown(plot, { key: 'Escape' });
    expect(screen.queryByTestId('chat-chart-tooltip')).toBeNull();
  });

  it('describes the chart to assistive tech', () => {
    renderChart({ chartType: 'bar' });
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'toolUi.chart.summary');
  });

  it('reads a pie slice on hover', () => {
    renderChart({ chartType: 'pie' });
    fireEvent.pointerMove(marks('slice')[1]!);
    expect(screen.getByTestId('chat-chart-tooltip')).toHaveTextContent('Q2');
  });
});

describe('chart geometry', () => {
  it('builds clean ticks that span the data', () => {
    expect(niceTicks(0, 30)).toEqual([0, 10, 20, 30]);
    expect(niceTicks(0, 7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(-10, 10)).toEqual([-10, -5, 0, 5, 10]);
  });

  it('does not divide by zero on a flat series', () => {
    expect(niceTicks(0, 0).length).toBeGreaterThan(1);
    expect(niceTicks(5, 5).length).toBeGreaterThan(1);
  });

  it('keeps the bar foot square on the baseline', () => {
    const path = barPath(10, 20, 100, 40);
    expect(path.startsWith('M10,100')).toBe(true);
    expect(path).toContain('L30,100');
  });

  it('closes a slice through the centre', () => {
    expect(sliceGeometry(50, 50, 40, 0, Math.PI / 2).startsWith('M50,50')).toBe(true);
  });

  it('shares the whole circle between slices', () => {
    const slices = pieSlices([1, null, 3]);
    expect(slices.map((slice) => slice.share)).toEqual([0.25, 0, 0.75]);
    expect(slices.at(-1)!.end - slices[0]!.start).toBeCloseTo(Math.PI * 2);
  });
});

describe('Chart through the conversation path', () => {
  it('renders a fenced line chart as a line chart', () => {
    const { interactions } = parseToolUiContent(fence({ type: 'chart', chart_type: 'line', title: 'Latency', ...base }));
    render(<AgentInteractionRenderer interactions={interactions} />);
    expect(screen.getByTestId('chat-tool-ui-chart')).toHaveAttribute('data-chart-type', 'line');
    expect(marks('line')).toHaveLength(1);
    expect(screen.getByTestId('chat-tool-ui-card')).toHaveTextContent('Latency');
  });
});
