/**
 * P1-1 新增：CDP 生命周期加固单测。
 *
 * 覆盖：
 * - normalizeDetachReason 4 种原因映射 + unknown
 * - isBrowserControlRestrictedUrl 受限 URL 拒绝（chrome:// / app:// / file:// 等）
 * - setEnabled 全局开关：关闭后立即 detach、动作被拒；开启后可用
 * - 开关默认关闭（不持久化）
 */

import { describe, expect, it } from 'vitest';
import { normalizeDetachReason } from '../src/engine/browser-control/browser-debugger-connection';
import { isBrowserControlRestrictedUrl } from '../src/core/browser-control';
import { AgentBrowserService } from '../src/engine/service';

describe('P1-1 normalizeDetachReason', () => {
  it('映射 canceled_by_user', () => {
    expect(normalizeDetachReason('canceled_by_user')).toBe('canceled_by_user');
  });

  it('映射 target_closed', () => {
    expect(normalizeDetachReason('target_closed')).toBe('target_closed');
  });

  it('映射 replaced_with_devtools 为 tab_removed', () => {
    expect(normalizeDetachReason('replaced_with_devtools')).toBe('tab_removed');
  });

  it('映射 tab_removed', () => {
    expect(normalizeDetachReason('tab_removed')).toBe('tab_removed');
  });

  it('映射 disabled_by_user', () => {
    expect(normalizeDetachReason('disabled_by_user')).toBe('disabled_by_user');
  });

  it('未知原因映射为 unknown', () => {
    expect(normalizeDetachReason('some_other_reason')).toBe('unknown');
  });

  it('undefined 映射为 unknown', () => {
    expect(normalizeDetachReason(undefined)).toBe('unknown');
  });
});

describe('P1-1 isBrowserControlRestrictedUrl', () => {
  it('拒绝 chrome:// 内部页', () => {
    expect(isBrowserControlRestrictedUrl('chrome://settings')).toBe(true);
  });

  it('拒绝 edge:// 内部页', () => {
    expect(isBrowserControlRestrictedUrl('edge://settings')).toBe(true);
  });

  it('拒绝 about: 页面', () => {
    expect(isBrowserControlRestrictedUrl('about:blank')).toBe(true);
  });

  it('拒绝 chrome-extension:// 页面', () => {
    expect(isBrowserControlRestrictedUrl('chrome-extension://abc/options.html')).toBe(true);
  });

  it('拒绝 view-source: 页面', () => {
    expect(isBrowserControlRestrictedUrl('view-source:https://example.com')).toBe(true);
  });

  it('拒绝 Chrome Web Store', () => {
    expect(isBrowserControlRestrictedUrl('https://chromewebstore.google.com')).toBe(true);
    expect(isBrowserControlRestrictedUrl('https://chrome.google.com/webstore')).toBe(true);
  });

  it('拒绝 Electron app:// 内部页', () => {
    expect(isBrowserControlRestrictedUrl('app://browser/index.html')).toBe(true);
  });

  it('拒绝 Electron clawx:// 内部页', () => {
    expect(isBrowserControlRestrictedUrl('clawx://settings')).toBe(true);
  });

  it('拒绝 file:// 本地文件协议', () => {
    expect(isBrowserControlRestrictedUrl('file:///C:/test.html')).toBe(true);
  });

  it('允许普通 https 网页', () => {
    expect(isBrowserControlRestrictedUrl('https://example.com')).toBe(false);
  });

  it('允许普通 http 网页', () => {
    expect(isBrowserControlRestrictedUrl('http://localhost:3000')).toBe(false);
  });

  it('空 URL 视为受限', () => {
    expect(isBrowserControlRestrictedUrl('')).toBe(true);
    expect(isBrowserControlRestrictedUrl('   ')).toBe(true);
  });
});

describe('P1-1 AgentBrowserService setEnabled 全局开关', () => {
  it('默认关闭', () => {
    const service = new AgentBrowserService({});
    expect(service.isEnabled()).toBe(false);
  });

  it('开启后 isEnabled 返回 true', () => {
    const service = new AgentBrowserService({});
    const result = service.setEnabled(true);
    expect(result.enabled).toBe(true);
    expect(service.isEnabled()).toBe(true);
  });

  it('关闭后 isEnabled 返回 false', () => {
    const service = new AgentBrowserService({});
    service.setEnabled(true);
    const result = service.setEnabled(false);
    expect(result.enabled).toBe(false);
    expect(service.isEnabled()).toBe(false);
  });

  it('开关关闭时 takeSnapshot 被拒', async () => {
    const service = new AgentBrowserService({});
    // 不调用 setEnabled，默认关闭；assertBrowserControlEnabled 在 getRecord 之前执行
    await expect(
      service.takeSnapshot({ sessionId: 'any-session' }),
    ).rejects.toThrow('浏览器控制未开启');
  });
});
