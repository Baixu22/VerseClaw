import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAutomationPlaybookSelectionPrompt,
  selectAutomationPlaybook,
  type AutomationPlaybookModelInvoker,
} from "../src/core/automation-playbook-selector";
import { getRegisteredAutomationPlaybooks } from "../src/core/automation-playbooks";

function createInvokeModel(responseContent: string): AutomationPlaybookModelInvoker {
  return vi.fn(async () => responseContent);
}

describe("automation-playbook-selector（注入式模型预选）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createAutomationPlaybookSelectionPrompt 构造 system + user 双消息且包含候选", () => {
    const messages = createAutomationPlaybookSelectionPrompt({
      userContent: "排查当前页面错误",
      pageContextSummary: "标题：后台\nURL：https://example.com",
      playbooks: getRegisteredAutomationPlaybooks(),
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("只返回 JSON");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("排查当前页面错误");
    expect(messages[1].content).toContain("标题：后台");
    expect(messages[1].content).toContain("Network/API 分析");
  });

  it("从模型返回的 JSON 中解析启用的 Playbook", async () => {
    const invokeModel = createInvokeModel(
      '{"playbookId":"network_api_analysis","confidence":"high","reason":"用户要求分析接口"}',
    );

    const result = await selectAutomationPlaybook({
      userContent: "分析当前页面这个接口参数",
      playbooks: getRegisteredAutomationPlaybooks(),
      invokeModel,
    });

    expect(result).toEqual({
      playbookId: "network_api_analysis",
      title: "Network/API 分析",
      source: "builtin",
      confidence: "high",
      reason: "用户要求分析接口",
    });
    expect(invokeModel).toHaveBeenCalledTimes(1);
    const callArg = (invokeModel as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(callArg.messages[1].content).toContain("Network/API 分析");
  });

  it("playbookId 为 null 时返回 undefined", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      selectAutomationPlaybook({
        userContent: "看看当前页面",
        playbooks: getRegisteredAutomationPlaybooks(),
        invokeModel: createInvokeModel('{"playbookId":null,"confidence":"low","reason":"不需要"}'),
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[automation-playbook] 已跳过任务策略预选：",
      expect.objectContaining({ reason: "模型未选择策略" }),
    );
  });

  it("未知 playbookId 时返回 undefined", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      selectAutomationPlaybook({
        userContent: "看看当前页面",
        playbooks: getRegisteredAutomationPlaybooks(),
        invokeModel: createInvokeModel('{"playbookId":"missing","confidence":"high","reason":"未知"}'),
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[automation-playbook] 已跳过任务策略预选：",
      expect.objectContaining({ reason: "模型返回未知或禁用策略" }),
    );
  });

  it("畸形 JSON 时返回 undefined", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      selectAutomationPlaybook({
        userContent: "看看当前页面",
        playbooks: getRegisteredAutomationPlaybooks(),
        invokeModel: createInvokeModel("不是 JSON"),
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[automation-playbook] 已跳过任务策略预选：",
      expect.objectContaining({ reason: "模型响应 JSON 无效" }),
    );
  });

  it("invokeModel 抛错时返回 undefined 且不阻断", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invokeModel = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(
      selectAutomationPlaybook({
        userContent: "看看当前页面",
        playbooks: getRegisteredAutomationPlaybooks(),
        invokeModel: invokeModel as AutomationPlaybookModelInvoker,
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[automation-playbook] 已跳过任务策略预选：",
      expect.objectContaining({ reason: "预选请求异常", errorName: "Error" }),
    );
  });

  it("空 playbooks 时直接返回 undefined 且不调用模型", async () => {
    const invokeModel = vi.fn(async () => "should not be called");
    await expect(
      selectAutomationPlaybook({
        userContent: "看看当前页面",
        playbooks: [],
        invokeModel: invokeModel as AutomationPlaybookModelInvoker,
      }),
    ).resolves.toBeUndefined();
    expect(invokeModel).not.toHaveBeenCalled();
  });

  it("支持 fenced code block 形式的 JSON 响应", async () => {
    const invokeModel = createInvokeModel(
      '```json\n{"playbookId":"page_reading","confidence":"medium","reason":"阅读页面"}\n```',
    );
    const result = await selectAutomationPlaybook({
      userContent: "总结当前页面内容",
      playbooks: getRegisteredAutomationPlaybooks(),
      invokeModel,
    });
    expect(result).toEqual({
      playbookId: "page_reading",
      title: "页面阅读",
      source: "builtin",
      confidence: "medium",
      reason: "阅读页面",
    });
  });
});
