import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  OfficialBrowserIcon,
  OfficialFilesIcon,
  OfficialReviewIcon,
  OfficialTerminalIcon,
} from '@/components/icons/official-workspace-icons';
import {
  ArrowLeft,
  Camera,
  Ellipsis,
  PanelBottom,
  RefreshCw,
  X,
} from '@/components/icons/codex-icons';

describe('FakeCoding workspace SVG assets', () => {
  it('preserves the official 20x20 filled tab icon contract and key geometry', () => {
    const review = renderToStaticMarkup(createElement(OfficialReviewIcon, { size: 20 }));
    const terminal = renderToStaticMarkup(createElement(OfficialTerminalIcon, { size: 20 }));
    const browser = renderToStaticMarkup(createElement(OfficialBrowserIcon, { size: 20 }));
    const files = renderToStaticMarkup(createElement(OfficialFilesIcon, { size: 20 }));

    for (const markup of [review, terminal, browser, files]) {
      expect(markup).toContain('viewBox="0 0 20 20"');
      expect(markup).toContain('width="20"');
      expect(markup).toContain('height="20"');
      expect(markup).not.toContain('stroke-width');
    }
    expect(review).toContain('M12.084 12.668a.666.666 0 0 1 0 1.33H7.917');
    expect(terminal).toContain('M6.19629 7.86231C6.42357 7.63534');
    expect(terminal).toContain('fill="none"');
    expect(terminal).toContain('fill="currentColor"');
    expect(browser).toContain('M10 2.125C14.3492 2.125 17.875 5.65076');
    expect(files).toContain('M1.418 13.667V9.25');
  });

  it('preserves the 24x24 stroke command icon attributes and paths', () => {
    const cases = [
      [ArrowLeft, 'm12 19-7-7 7-7'],
      [Camera, 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9'],
      [Ellipsis, 'cx="12" cy="12" r="1"'],
      [PanelBottom, 'M3 15h18'],
      [RefreshCw, 'M3 12a9 9 0 0 1 9-9'],
      [X, 'M18 6 6 18'],
    ] as const;

    for (const [Icon, path] of cases) {
      const markup = renderToStaticMarkup(createElement(Icon, { size: 24 }));
      expect(markup).toContain('viewBox="0 0 24 24"');
      expect(markup).toContain('fill="none"');
      expect(markup).toContain('stroke="currentColor"');
      expect(markup).toContain('stroke-width="2"');
      expect(markup).toContain('stroke-linecap="round"');
      expect(markup).toContain('stroke-linejoin="round"');
      expect(markup).toContain(path);
    }
  });
});
