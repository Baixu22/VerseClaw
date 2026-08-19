import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const knowledgeUiPath = join(repoRoot, 'src', 'pages', 'Knowledge', 'index.tsx');

describe('KS-08 governance lifecycle UI boundary', () => {
  it('routes all lifecycle operations through applyReviewedChange instead of direct hostApi.knowledge.<operation> calls', () => {
    const source = readFileSync(knowledgeUiPath, 'utf8');
    for (const operation of ['update', 'merge', 'archive', 'revoke', 'delete', 'restore']) {
      expect(source).not.toContain(`hostApi.knowledge.${operation}(`);
    }
    expect(source).toContain('hostApi.knowledge.applyReviewedChange');
    expect(source).toContain('hostApi.knowledge.listGovernanceReceipts');
  });

  it('exposes a lifecycle proposal UI with all six supported operations and receipt history', () => {
    const source = readFileSync(knowledgeUiPath, 'utf8');
    expect(source).toContain("data-testid=\"knowledge-lifecycle-operation\"");
    expect(source).toContain("t(`lifecycle.operation.${operation}`)");
    for (const operation of ['update', 'merge', 'archive', 'revoke', 'delete', 'restore']) {
      expect(source).toContain(`'${operation}'`);
    }
    expect(source).toContain('data-testid="knowledge-lifecycle-receipt-json"');
    expect(source).toContain('data-testid="knowledge-receipt-history"');
  });
});
