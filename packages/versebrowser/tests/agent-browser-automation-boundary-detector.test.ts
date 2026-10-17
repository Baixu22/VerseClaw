/**
 * P1-3 新增：automationBoundaryDetector 单测。
 *
 * 覆盖：
 * - detectAutomationBoundarySignals 8 种信号检测
 *   （脱敏/截断/请求重放/JS上下文/Runtime边界/页面副作用/跨站跳转/文件访问）
 * - applyAutomationBoundaryConfirmation 无信号时原样返回
 * - applyAutomationBoundaryConfirmation 有信号时追加边界提示
 * - createBoundaryConfirmationRequest 的 choices 构建
 * - 无 confirmBoundary 回调时仍返回带提示的结果
 */

import { describe, expect, it, vi } from 'vitest';
import {
  applyAutomationBoundaryConfirmation,
  detectAutomationBoundarySignals,
  type AutomationBoundaryConfirmation,
} from '../src/engine/browser-control/automation-boundary-detector';

describe('P1-3 detectAutomationBoundarySignals', () => {
  it('检测脱敏标记', () => {
    const signals = detectAutomationBoundarySignals('结果包含 [已脱敏] 标记');
    expect(signals.some((s) => s.id === 'redacted_sensitive_fields')).toBe(true);
  });

  it('检测敏感字段名 Authorization', () => {
    const signals = detectAutomationBoundarySignals('Authorization: Bearer xyz');
    expect(signals.some((s) => s.id === 'redacted_sensitive_fields')).toBe(true);
  });

  it('检测敏感字段的同族键名', () => {
    // C96/TF-0123: the inline key rules used to omit these, so a raw api_key body raised no
    // boundary signal while token= did (measured 2026-10-14).
    const cases = [
      'api_key=AKIA1234567890',
      '{"api_key": "AKIA1234567890"}',
      'credential=abc123',
      '{"private_key": "MATERIAL"}',
      'otp=482915',
      'cookie=sid-abcdef123456',
      'authorization=Bearer sk-live-abcdef123456',
    ];
    for (const content of cases) {
      expect(
        detectAutomationBoundarySignals(content).some((s) => s.id === 'redacted_sensitive_fields'),
        content,
      ).toBe(true);
    }
  });

  it('检测截断标记', () => {
    const signals = detectAutomationBoundarySignals('Truncated: true');
    expect(signals.some((s) => s.id === 'truncated_summary')).toBe(true);
  });

  it('检测请求重放确认', () => {
    const signals = detectAutomationBoundarySignals('发送请求重放前必须先通过用户边界确认');
    expect(signals.some((s) => s.id === 'request_replay_confirmation')).toBe(true);
  });

  it('检测请求重放沙箱边界', () => {
    const signals = detectAutomationBoundarySignals('请求重放只允许 GET 方法');
    expect(signals.some((s) => s.id === 'request_replay_confirmation')).toBe(true);
  });

  it('检测 JS 上下文扩展', () => {
    const signals = detectAutomationBoundarySignals('同源 JS 补位不可用');
    expect(signals.some((s) => s.id === 'js_or_sourcemap_context_expansion')).toBe(true);
  });

  it('检测 Runtime 边界', () => {
    const signals = detectAutomationBoundarySignals('运行时只读分析未授权');
    expect(signals.some((s) => s.id === 'runtime_or_full_access_boundary')).toBe(true);
  });

  it('检测页面副作用操作', () => {
    const signals = detectAutomationBoundarySignals('页面操作可能触发表单提交');
    expect(signals.some((s) => s.id === 'page_effect_confirmation')).toBe(true);
  });

  it('检测跨站点跳转', () => {
    const signals = detectAutomationBoundarySignals('检测到跨站点跳转');
    expect(signals.some((s) => s.id === 'cross_site_navigation_confirmation')).toBe(true);
  });

  it('检测文件上传下载', () => {
    const signals = detectAutomationBoundarySignals('触发文件下载');
    expect(signals.some((s) => s.id === 'file_access_confirmation')).toBe(true);
  });

  it('无信号返回空数组', () => {
    const signals = detectAutomationBoundarySignals('普通文本，无边界信号');
    expect(signals).toEqual([]);
  });

  it('多信号同时检测', () => {
    const content = '结果包含 [已脱敏] 且 Truncated: true';
    const signals = detectAutomationBoundarySignals(content);
    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.id).sort()).toEqual(['redacted_sensitive_fields', 'truncated_summary']);
  });

  it('去重：同一信号只出现一次', () => {
    const content = '[已脱敏] [已脱敏] [REDACTED]';
    const signals = detectAutomationBoundarySignals(content);
    expect(signals.filter((s) => s.id === 'redacted_sensitive_fields')).toHaveLength(1);
  });
});

describe('P1-3 applyAutomationBoundaryConfirmation', () => {
  it('无信号时原样返回', async () => {
    const result = { content: '普通文本' };
    const confirmBoundary = vi.fn();
    const processed = await applyAutomationBoundaryConfirmation(result, confirmBoundary);
    expect(processed.content).toBe('普通文本');
    expect(confirmBoundary).not.toHaveBeenCalled();
  });

  it('有信号时追加边界提示', async () => {
    const result = { content: '结果包含 [已脱敏] 标记' };
    const processed = await applyAutomationBoundaryConfirmation(result, undefined);
    expect(processed.content).toContain('结果包含 [已脱敏] 标记');
    expect(processed.content).toContain('受控增强权限边界提示');
    expect(processed.content).toContain('脱敏或敏感字段');
  });

  it('有 confirmBoundary 回调时调用并追加确认结果', async () => {
    const result = { content: '结果包含 [已脱敏] 标记' };
    const confirmBoundary = vi.fn().mockResolvedValue('用户已确认') as unknown as AutomationBoundaryConfirmation;
    const processed = await applyAutomationBoundaryConfirmation(result, confirmBoundary);
    expect(confirmBoundary).toHaveBeenCalledOnce();
    expect(processed.content).toContain('用户已确认');
    expect(processed.content).toContain('用户已经完成本轮边界确认');
  });

  it('confirmBoundary 抛错时静默降级', async () => {
    const result = { content: '结果包含 [已脱敏] 标记' };
    const confirmBoundary = vi.fn().mockRejectedValue(new Error('UI 错误')) as unknown as AutomationBoundaryConfirmation;
    const processed = await applyAutomationBoundaryConfirmation(result, confirmBoundary);
    expect(processed.content).toContain('受控增强权限边界提示');
    expect(processed.content).toContain('在用户确认前，不得继续执行');
  });

  it('确认请求包含允许和不允许两个选项', async () => {
    const result = { content: '结果包含 [已脱敏] 标记' };
    let capturedRequest: { choices: Array<{ id: string; title: string }> } | undefined;
    const confirmBoundary = vi.fn(async (req) => {
      capturedRequest = req;
      return undefined;
    }) as unknown as AutomationBoundaryConfirmation;
    await applyAutomationBoundaryConfirmation(result, confirmBoundary);
    expect(capturedRequest?.choices).toBeDefined();
    const choiceIds = capturedRequest!.choices.map((c) => c.id);
    expect(choiceIds).toContain('allow_redacted_sensitive_fields');
    expect(choiceIds).toContain('keep_current_boundary');
  });

  it('多信号时 allowMultiple=true', async () => {
    const content = '[已脱敏] 且 Truncated: true';
    const result = { content };
    let capturedRequest: { allowMultiple: boolean } | undefined;
    const confirmBoundary = vi.fn(async (req) => {
      capturedRequest = req;
      return undefined;
    }) as unknown as AutomationBoundaryConfirmation;
    await applyAutomationBoundaryConfirmation(result, confirmBoundary);
    expect(capturedRequest?.allowMultiple).toBe(true);
  });

  it('单信号时 allowMultiple=false', async () => {
    const result = { content: '[已脱敏]' };
    let capturedRequest: { allowMultiple: boolean } | undefined;
    const confirmBoundary = vi.fn(async (req) => {
      capturedRequest = req;
      return undefined;
    }) as unknown as AutomationBoundaryConfirmation;
    await applyAutomationBoundaryConfirmation(result, confirmBoundary);
    expect(capturedRequest?.allowMultiple).toBe(false);
  });
});
