import { describe, expect, it, vi } from 'vitest';
import {
  createAutomationPlaybookSelectorTool,
  type AutomationPlaybookCandidate,
  type AutomationPlaybookSelectorFn,
} from '../../openclaw_runtime/src/agents/tools/automation-playbook-selector-tool';

function readJsonResult(result: unknown): Record<string, unknown> | undefined {
  const record = result as { content?: Array<{ text?: string }> };
  const text = record.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
}

const candidates: AutomationPlaybookCandidate[] = [
  {
    id: 'network_api_analysis',
    title: 'Network/API 分析',
    description: '捕获并分析网络请求',
    tags: ['network', 'api'],
    risk: 'normal_restricted',
  },
  {
    id: 'page_reading',
    title: '页面阅读',
    description: '提取页面文本内容',
    tags: ['reading', 'text'],
    risk: 'normal_restricted',
  },
];

describe('select_automation_playbook tool (B2)', () => {
  it('returns selected playbook when selector resolves', async () => {
    const select = vi.fn(async () => ({
      playbookId: 'network_api_analysis',
      title: 'Network/API 分析',
      source: 'builtin',
      confidence: 'high' as const,
      reason: '用户要求分析接口',
    })) as AutomationPlaybookSelectorFn;
    const tool = createAutomationPlaybookSelectorTool({ select, candidates });

    const result = await tool.execute('tool-1', {
      userContent: '分析当前页面这个接口参数',
    });
    const payload = readJsonResult(result);

    expect(payload).toMatchObject({
      selected: true,
      selection: {
        playbookId: 'network_api_analysis',
        title: 'Network/API 分析',
        confidence: 'high',
        reason: '用户要求分析接口',
      },
      candidates: [
        { id: 'network_api_analysis', title: 'Network/API 分析', risk: 'normal_restricted' },
        { id: 'page_reading', title: '页面阅读', risk: 'normal_restricted' },
      ],
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect((vi.mocked(select).mock.calls[0][0])).toMatchObject({ userContent: '分析当前页面这个接口参数' });
  });

  it('returns selected:false when selector returns undefined', async () => {
    const select = vi.fn(async () => undefined) as AutomationPlaybookSelectorFn;
    const tool = createAutomationPlaybookSelectorTool({ select, candidates });

    const result = await tool.execute('tool-1', {
      userContent: '看看当前页面',
    });
    const payload = readJsonResult(result);

    expect(payload).toMatchObject({
      selected: false,
      selection: null,
    });
  });

  it('forwards pageContextSummary to selector when provided', async () => {
    const select = vi.fn(async () => ({
      playbookId: 'page_reading',
      title: '页面阅读',
      source: 'builtin',
      confidence: 'medium' as const,
      reason: '阅读页面',
    })) as AutomationPlaybookSelectorFn;
    const tool = createAutomationPlaybookSelectorTool({ select, candidates });

    await tool.execute('tool-1', {
      userContent: '总结当前页面内容',
      pageContextSummary: '标题：后台\nURL：https://example.com',
    });

    expect((vi.mocked(select).mock.calls[0][0])).toMatchObject({
      userContent: '总结当前页面内容',
      pageContextSummary: '标题：后台\nURL：https://example.com',
    });
  });

  it('omits pageContextSummary from selector input when not provided', async () => {
    const select = vi.fn(async () => undefined) as AutomationPlaybookSelectorFn;
    const tool = createAutomationPlaybookSelectorTool({ select, candidates });

    await tool.execute('tool-1', {
      userContent: '看看页面',
    });

    const input = (vi.mocked(select).mock.calls[0][0]) as { userContent: string; pageContextSummary?: string };
    expect(input.userContent).toBe('看看页面');
    expect(input.pageContextSummary).toBeUndefined();
  });

  it('propagates selector errors', async () => {
    const select = vi.fn(async () => {
      throw new Error('model timeout');
    }) as AutomationPlaybookSelectorFn;
    const tool = createAutomationPlaybookSelectorTool({ select, candidates });

    await expect(
      tool.execute('tool-1', { userContent: '分析接口' }),
    ).rejects.toThrow('model timeout');
  });

  it('has stable name and label metadata', () => {
    const select = vi.fn(async () => undefined) as AutomationPlaybookSelectorFn;
    const tool = createAutomationPlaybookSelectorTool({ select, candidates });

    expect(tool.name).toBe('select_automation_playbook');
    expect(tool.label).toBe('Automation Playbook Selector');
    expect(tool.description).toContain('playbook');
    expect(tool.parameters).toBeDefined();
  });
});
