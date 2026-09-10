// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildBootstrapContextFiles } from '../../openclaw_runtime/src/agents/embedded-agent-helpers/bootstrap';

const memoryContent = [
  '# Long-Term Memory',
  '',
  '## 2026-07-01',
  'Remember that the release pipeline uses pnpm workspaces.',
  '',
  '## 2026-07-02',
  'Keep in mind the staging server requires VPN access.',
  '',
  '## 2026-07-03',
  'The build cache should be cleared weekly.',
].join('\n');

function memoryFile() {
  return {
    name: 'MEMORY.md',
    path: '/workspace/MEMORY.md',
    content: memoryContent,
    missing: false,
  };
}

describe('P1-4 MEMORY.md bootstrap retrieval', () => {
  it('injects keyword-matched Top-K snippets instead of the full file', () => {
    const files = [memoryFile()];
    const context = buildBootstrapContextFiles(files as never, {
      memoryKeywords: ['release pipeline pnpm'],
    });
    expect(context).toHaveLength(1);
    const injected = context[0].content;
    // The matched block about the release pipeline is present…
    expect(injected).toContain('release pipeline uses pnpm workspaces');
    // …and unrelated blocks are dropped.
    expect(injected).not.toContain('staging server requires VPN');
    expect(injected).not.toContain('build cache should be cleared');
  });

  it('falls back to the bounded full-file trim when retrieval yields no hits', () => {
    const files = [memoryFile()];
    const context = buildBootstrapContextFiles(files as never, {
      memoryKeywords: ['completely-unrelated-topic-xyz'],
    });
    expect(context).toHaveLength(1);
    // No keyword hits: the normal bounded trim path must still inject content.
    expect(context[0].content.length).toBeGreaterThan(0);
  });

  it('injects full content when no keywords are supplied (backward compatible)', () => {
    const files = [memoryFile()];
    const context = buildBootstrapContextFiles(files as never, {});
    expect(context).toHaveLength(1);
    expect(context[0].content).toContain('release pipeline uses pnpm workspaces');
    expect(context[0].content).toContain('staging server requires VPN');
  });

  it('matches Chinese keywords', () => {
    const files = [{
      name: 'MEMORY.md',
      path: '/workspace/MEMORY.md',
      content: '记住：发布流程使用 pnpm。\n\n下次发布前检查 VPN。\n\n其他无关内容。',
      missing: false,
    }];
    const context = buildBootstrapContextFiles(files as never, {
      memoryKeywords: ['发布流程 pnpm'],
    });
    expect(context).toHaveLength(1);
    expect(context[0].content).toContain('发布流程使用 pnpm');
    expect(context[0].content).not.toContain('无关内容');
  });

  it('caps snippets at the per-snippet length bound', () => {
    const longBlock = 'Remember that '.concat('x'.repeat(600));
    const files = [{
      name: 'MEMORY.md',
      path: '/workspace/MEMORY.md',
      content: `# Memory\n\n${longBlock}\n\nOther block.`,
      missing: false,
    }];
    const context = buildBootstrapContextFiles(files as never, {
      memoryKeywords: ['remember'],
    });
    expect(context).toHaveLength(1);
    // Per-snippet cap is 400 chars plus the ellipsis marker.
    expect(context[0].content.length).toBeLessThanOrEqual(405);
    expect(context[0].content.endsWith('…')).toBe(true);
  });
});
