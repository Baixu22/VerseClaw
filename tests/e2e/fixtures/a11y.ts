import type { Page } from '@playwright/test';
import { expect } from './electron';

export type BasicA11yIssue = {
  rule: string;
  selector: string;
  message: string;
};

export type BasicA11yReport = {
  checkedAt: string;
  url: string;
  issueCount: number;
  issues: BasicA11yIssue[];
};

export async function scanBasicAccessibility(page: Page): Promise<BasicA11yReport> {
  return await page.evaluate(() => {
    const cssPath = (element: Element): string => {
      const testId = element.getAttribute('data-testid') ?? element.closest('[data-testid]')?.getAttribute('data-testid');
      if (testId) return `[data-testid="${testId}"]`;
      const id = element.getAttribute('id');
      if (id) return `#${CSS.escape(id)}`;
      const tag = element.tagName.toLowerCase();
      const parent = element.parentElement;
      if (!parent) return tag;
      const index = [...parent.children].indexOf(element) + 1;
      return `${tag}:nth-child(${index})`;
    };

    const text = (element: Element): string => element.textContent?.trim() ?? '';
    const hasName = (element: Element): boolean => {
      const ariaLabel = element.getAttribute('aria-label')?.trim();
      const labelledBy = element.getAttribute('aria-labelledby')?.trim();
      const title = element.getAttribute('title')?.trim();
      return Boolean(ariaLabel || labelledBy || title || text(element));
    };
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const issues: BasicA11yIssue[] = [];
    const add = (rule: string, element: Element, message: string) => {
      if (isVisible(element)) issues.push({ rule, selector: cssPath(element), message });
    };

    document.querySelectorAll('button, [role="button"], a[href]').forEach((element) => {
      if (!hasName(element)) add('interactive-name', element, 'Interactive element has no accessible name.');
    });
    document.querySelectorAll('input, textarea, select').forEach((element) => {
      const id = element.getAttribute('id');
      const named = hasName(element)
        || Boolean(element.getAttribute('placeholder')?.trim())
        || Boolean(id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
      if (!named) add('form-label', element, 'Form control has no label, placeholder, or accessible name.');
    });
    document.querySelectorAll('img').forEach((element) => {
      if (!element.hasAttribute('alt')) add('image-alt', element, 'Image is missing alt text.');
    });
    document.querySelectorAll('[role="dialog"], [data-radix-dialog-content]').forEach((element) => {
      if (!hasName(element)) add('dialog-name', element, 'Dialog has no accessible name.');
    });
    const ids = new Map<string, Element[]>();
    document.querySelectorAll('[id]').forEach((element) => {
      const id = element.getAttribute('id');
      if (!id) return;
      ids.set(id, [...(ids.get(id) ?? []), element]);
    });
    for (const [id, elements] of ids) {
      if (elements.length > 1) add('duplicate-id', elements[0], `Duplicate id "${id}" appears ${elements.length} times.`);
    }

    return {
      checkedAt: new Date().toISOString(),
      url: window.location.href,
      issueCount: issues.length,
      issues,
    };
  });
}

export async function expectNoBasicA11yIssues(page: Page): Promise<void> {
  const report = await scanBasicAccessibility(page);
  expect(report.issues, JSON.stringify(report, null, 2)).toEqual([]);
}
