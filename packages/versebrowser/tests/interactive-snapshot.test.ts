/**
 * 阶段三：默认 snapshot 必须可操作（交互元素 + 稳定 ref），不能只省字节。
 */
import { describe, expect, it } from 'vitest';
import {
  CLICKABLE_DISCOVERY_ENV,
  CLICKABLE_DISCOVERY_LIMIT,
  COLLECT_INTERACTIVE_EXPRESSION,
  buildCollectInteractiveExpression,
  formatActionableSnapshot,
  resolveClickableDiscovery,
  resolveRefSelector,
  type InteractiveElement,
} from '../src/engine/interactive-snapshot.ts';

const METRICS = {
  title: 'Shop',
  url: 'https://shop.test/checkout',
  htmlBytes: 1200,
  textChars: 400,
};

const ITEMS: InteractiveElement[] = [
  { ref: 'e1', tag: 'button', role: 'button', name: 'Buy' },
  { ref: 'e2', tag: 'input', role: 'textbox', name: 'Email', value: 'a@b.c' },
  { ref: 'e3', tag: 'a', role: 'link', name: 'Home', href: '/' },
  { ref: 'e4', tag: 'button', role: 'button', name: 'Submit', disabled: true },
];

describe('actionable compact snapshot', () => {
  it('lists interactive elements with usable [data-vb-ref] selectors', () => {
    const text = formatActionableSnapshot(METRICS, ITEMS);
    expect(text).toContain('## Interactive (4)');
    expect(text).toContain('[e1]');
    expect(text).toContain('sel=[data-vb-ref="e1"]');
    expect(text).toContain('vb_click / vb_type');
    // Must include the purchase path pieces an agent needs without reading HTML.
    expect(text).toMatch(/button \| "Buy"/u);
    expect(text).toMatch(/textbox \| "Email" \| value="a@b\.c"/u);
    expect(text).toMatch(/disabled/u);
  });

  it('keeps metrics but does not bury interactive refs', () => {
    const text = formatActionableSnapshot(METRICS, ITEMS);
    const interactiveAt = text.indexOf('## Interactive');
    const metricsAt = text.indexOf('## Metrics');
    expect(interactiveAt).toBeGreaterThan(-1);
    expect(metricsAt).toBeGreaterThan(interactiveAt);
    expect(text).toContain('html_bytes: 1200');
  });

  it('empty interactive list is explicit, not silent', () => {
    const text = formatActionableSnapshot(METRICS, []);
    expect(text).toContain('## Interactive (0)');
    expect(text).toContain('no interactive elements observed');
  });

  it('resolveRefSelector accepts bare ref or full attribute selector', () => {
    expect(resolveRefSelector('e1')).toBe('[data-vb-ref="e1"]');
    expect(resolveRefSelector('[data-vb-ref="e2"]')).toBe('[data-vb-ref="e2"]');
    expect(resolveRefSelector('e3')).toContain('data-vb-ref');
  });

  it('collect expression tags nodes and strips previous refs', () => {
    expect(COLLECT_INTERACTIVE_EXPRESSION).toContain('data-vb-ref');
    expect(COLLECT_INTERACTIVE_EXPRESSION).toContain('removeAttribute');
    expect(COLLECT_INTERACTIVE_EXPRESSION).toContain('checkVisibility');
  });

  it('可点击元素发现规则默认关闭（TF-0092）：默认表达式不含 cursor:pointer 分支', () => {
    expect(CLICKABLE_DISCOVERY_ENV).toBe('VERSEBROWSER_SNAPSHOT_CLICKABLE');
    expect(COLLECT_INTERACTIVE_EXPRESSION).not.toContain('clickable');
    expect(COLLECT_INTERACTIVE_EXPRESSION).not.toContain('cursor');
    expect(buildCollectInteractiveExpression()).toBe(COLLECT_INTERACTIVE_EXPRESSION);
  });

  it('开启后表达式包含可解释的判据、上限与取舍', () => {
    const enabled = buildCollectInteractiveExpression({ clickable: 'pointer' });
    expect(enabled).toContain("cursor !== 'pointer'");
    expect(enabled).toContain(`extras.length >= ${CLICKABLE_DISCOVERY_LIMIT}`);
    // 只在叶子式、无交互后代、位于已收录元素之外时才补 —— 避免把整块容器收进来
    expect(enabled).toContain('el.querySelector(SELECTOR)');
    expect(enabled).toContain("el.closest('[data-vb-ref]')");
    expect(enabled).toContain("role: el.getAttribute('role') || 'clickable'");
    expect(enabled.length).toBeGreaterThan(COLLECT_INTERACTIVE_EXPRESSION.length);
  });

  it('开关只认 pointer，其余值一律 off', () => {
    expect(resolveClickableDiscovery({})).toBe('off');
    expect(resolveClickableDiscovery({ [CLICKABLE_DISCOVERY_ENV]: 'off' })).toBe('off');
    expect(resolveClickableDiscovery({ [CLICKABLE_DISCOVERY_ENV]: '1' })).toBe('off');
    expect(resolveClickableDiscovery({ [CLICKABLE_DISCOVERY_ENV]: ' POINTER ' })).toBe('pointer');
  });
});
