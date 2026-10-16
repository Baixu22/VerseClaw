/**
 * P1-4：工具分类矩阵与四层拦截链路单测。
 *
 * 覆盖：
 * - TOOL_INTERCEPTION_LAYER_SPECS：四层定义完整且层级顺序正确
 * - getToolInterceptionLayerOrder：返回四层顺序
 * - isToolAvailableUnderInterception：包装 isToolRuntimeAvailable 的运行态校验
 * - filterToolsByRuntimeAvailability：批量过滤不可用工具
 *
 * mock 策略：纯函数测试，不依赖外部 mock。
 */

import { describe, expect, it } from 'vitest';
import {
  TOOL_INTERCEPTION_LAYERS,
  TOOL_INTERCEPTION_LAYER_SPECS,
  isToolAvailableUnderInterception,
  filterToolsByRuntimeAvailability,
  getToolInterceptionLayerOrder,
} from '../src/core/tool-classification';
import {
  BROWSER_TAKE_SNAPSHOT_TOOL_ID,
  BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID,
  FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID,
  getRegisteredModelTools,
} from '../src/core/tool-registry';

describe('agent-browser 工具分类四层拦截链路', () => {
  it('四层拦截层级定义完整', () => {
    expect(TOOL_INTERCEPTION_LAYERS.L1_UI_GRAY_OUT).toBe('L1_UI_GRAY_OUT');
    expect(TOOL_INTERCEPTION_LAYERS.L2_BATCH_ENABLE_PRESET).toBe('L2_BATCH_ENABLE_PRESET');
    expect(TOOL_INTERCEPTION_LAYERS.L3_GATEWAY_BRIDGE_FILTER).toBe('L3_GATEWAY_BRIDGE_FILTER');
    expect(TOOL_INTERCEPTION_LAYERS.L4_SERVICE_REVALIDATE).toBe('L4_SERVICE_REVALIDATE');
  });

  it('TOOL_INTERCEPTION_LAYER_SPECS 按顺序定义四层', () => {
    expect(TOOL_INTERCEPTION_LAYER_SPECS).toHaveLength(4);
    expect(TOOL_INTERCEPTION_LAYER_SPECS[0].layer).toBe(TOOL_INTERCEPTION_LAYERS.L1_UI_GRAY_OUT);
    expect(TOOL_INTERCEPTION_LAYER_SPECS[1].layer).toBe(TOOL_INTERCEPTION_LAYERS.L2_BATCH_ENABLE_PRESET);
    expect(TOOL_INTERCEPTION_LAYER_SPECS[2].layer).toBe(TOOL_INTERCEPTION_LAYERS.L3_GATEWAY_BRIDGE_FILTER);
    expect(TOOL_INTERCEPTION_LAYER_SPECS[3].layer).toBe(TOOL_INTERCEPTION_LAYERS.L4_SERVICE_REVALIDATE);
  });

  it('每层规格都包含 label、description 和 rule', () => {
    for (const spec of TOOL_INTERCEPTION_LAYER_SPECS) {
      expect(spec.label).toBeTruthy();
      expect(spec.description).toBeTruthy();
      expect(spec.rule).toBeTruthy();
      expect(spec.rule.length).toBeGreaterThan(10);
    }
  });

  it('L1 规格描述 UI 置灰语义', () => {
    const l1 = TOOL_INTERCEPTION_LAYER_SPECS[0];
    expect(l1.label).toContain('L1 UI');
    expect(l1.description).toContain('置灰');
  });

  it('L2 规格描述批量启用跳过语义', () => {
    const l2 = TOOL_INTERCEPTION_LAYER_SPECS[1];
    expect(l2.label).toContain('L2 批量');
    expect(l2.rule).toContain('不能替代');
  });

  it('L3 规格描述 Gateway bridge 过滤语义', () => {
    const l3 = TOOL_INTERCEPTION_LAYER_SPECS[2];
    expect(l3.label).toContain('L3 Gateway');
    expect(l3.rule).toContain('browser.*');
    expect(l3.rule).toContain('二次过滤');
  });

  it('L4 规格描述 service 二次校验语义', () => {
    const l4 = TOOL_INTERCEPTION_LAYER_SPECS[3];
    expect(l4.label).toContain('L4 service');
    expect(l4.rule).toContain('二次校验');
    expect(l4.rule).toContain('不信任');
  });

  it('getToolInterceptionLayerOrder 返回四层顺序', () => {
    const order = getToolInterceptionLayerOrder();
    expect(order).toEqual([
      TOOL_INTERCEPTION_LAYERS.L1_UI_GRAY_OUT,
      TOOL_INTERCEPTION_LAYERS.L2_BATCH_ENABLE_PRESET,
      TOOL_INTERCEPTION_LAYERS.L3_GATEWAY_BRIDGE_FILTER,
      TOOL_INTERCEPTION_LAYERS.L4_SERVICE_REVALIDATE,
    ]);
  });

  it('isToolAvailableUnderInterception：browserControlEnabled 关闭时 browser_control 工具不可用', () => {
    const tools = getRegisteredModelTools();
    const snapshotTool = tools.find((tool) => tool.id === BROWSER_TAKE_SNAPSHOT_TOOL_ID)!;

    expect(isToolAvailableUnderInterception(snapshotTool, {
      browserControlEnabled: false,
      browserAutomationMode: 'normal_restricted',
    })).toBe(false);

    expect(isToolAvailableUnderInterception(snapshotTool, {
      browserControlEnabled: true,
      browserAutomationMode: 'normal_restricted',
    })).toBe(true);
  });

  it('isToolAvailableUnderInterception：controlled_enhanced 工具只在 controlled_enhanced 模式可用', () => {
    const tools = getRegisteredModelTools();
    const boundaryTool = tools.find((tool) => tool.id === BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID)!;

    expect(isToolAvailableUnderInterception(boundaryTool, {
      browserControlEnabled: true,
      browserAutomationMode: 'normal_restricted',
    })).toBe(false);

    expect(isToolAvailableUnderInterception(boundaryTool, {
      browserControlEnabled: true,
      browserAutomationMode: 'controlled_enhanced',
    })).toBe(true);

    expect(isToolAvailableUnderInterception(boundaryTool, {
      browserControlEnabled: true,
      browserAutomationMode: 'full_access',
    })).toBe(false);
  });

  it('isToolAvailableUnderInterception：full_access 工具只在 full_access 模式可用', () => {
    const tools = getRegisteredModelTools();
    const fullAccessTool = tools.find((tool) => tool.id === FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID)!;

    expect(isToolAvailableUnderInterception(fullAccessTool, {
      browserControlEnabled: true,
      browserAutomationMode: 'controlled_enhanced',
    })).toBe(false);

    expect(isToolAvailableUnderInterception(fullAccessTool, {
      browserControlEnabled: true,
      browserAutomationMode: 'full_access',
    })).toBe(true);
  });

  it('filterToolsByRuntimeAvailability：browserControlEnabled 关闭时所有 debugger 工具被过滤', () => {
    const allTools = getRegisteredModelTools();
    const filtered = filterToolsByRuntimeAvailability(allTools, {
      browserControlEnabled: false,
      browserAutomationMode: 'normal_restricted',
    });

    // 所有 agent-browser 工具都是 debugger 工具（runtime 为 browser_control/controlled_enhanced/full_access）
    // 关闭时全部被过滤
    expect(filtered).toHaveLength(0);
  });

  it('filterToolsByRuntimeAvailability：normal_restricted 模式只保留 browser_control 工具', () => {
    const allTools = getRegisteredModelTools();
    const filtered = filterToolsByRuntimeAvailability(allTools, {
      browserControlEnabled: true,
      browserAutomationMode: 'normal_restricted',
    });

    // 所有 browser_control 工具可用，controlled_enhanced 和 full_access 不可用
    const filteredRuntimes = new Set(filtered.map((tool) => tool.toolClassification?.runtime));
    expect(filteredRuntimes.has('browser_control')).toBe(true);
    expect(filteredRuntimes.has('controlled_enhanced')).toBe(false);
    expect(filteredRuntimes.has('full_access')).toBe(false);
    // 应该包含大量 browser_control 工具（browser.*/network.*/js.*/sourcemap.*/runtime.*）
    expect(filtered.length).toBeGreaterThan(30);
  });

  it('filterToolsByRuntimeAvailability：controlled_enhanced 模式保留 browser_control 和 controlled_enhanced 工具', () => {
    const allTools = getRegisteredModelTools();
    const filtered = filterToolsByRuntimeAvailability(allTools, {
      browserControlEnabled: true,
      browserAutomationMode: 'controlled_enhanced',
    });

    const filteredRuntimes = new Set(filtered.map((tool) => tool.toolClassification?.runtime));
    expect(filteredRuntimes.has('browser_control')).toBe(true);
    expect(filteredRuntimes.has('controlled_enhanced')).toBe(true);
    expect(filteredRuntimes.has('full_access')).toBe(false);

    // 应该包含 boundary_request_user_choice 和 replay.* 工具
    const filteredIds = filtered.map((tool) => tool.id);
    expect(filteredIds).toContain(BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID);
  });

  it('filterToolsByRuntimeAvailability：full_access 模式保留 browser_control 和 full_access 工具（不含 controlled_enhanced）', () => {
    const allTools = getRegisteredModelTools();
    const filtered = filterToolsByRuntimeAvailability(allTools, {
      browserControlEnabled: true,
      browserAutomationMode: 'full_access',
    });

    // full_access 模式下：browser_control 可用、full_access 可用，controlled_enhanced 不可用
    // （SRC 设计：full_access 不隐含 controlled_enhanced，boundary/replay 工具只在 controlled_enhanced 模式可用）
    const filteredRuntimes = new Set(filtered.map((tool) => tool.toolClassification?.runtime));
    expect(filteredRuntimes.has('browser_control')).toBe(true);
    expect(filteredRuntimes.has('controlled_enhanced')).toBe(false);
    expect(filteredRuntimes.has('full_access')).toBe(true);

    // 应该包含 full_access.* 工具
    const filteredIds = filtered.map((tool) => tool.id);
    expect(filteredIds).toContain(FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID);

    // 应该排除 controlled_enhanced 工具
    expect(filteredIds).not.toContain(BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID);
  });
});
