/**
 * TF-0114 (T-P0-6): Chinese regression corpus for the hybrid-retrieval text
 * path and context-pack keyword overlap. The defect class: pure Chinese input
 * produced 0 tokens / 0 entities and whole-run keyword matching, so the
 * taskMatch thresholds (0.35 / 0.75) were de facto unreachable for Chinese
 * text. These tests fail if the CJK bigram floor regresses.
 */
import { describe, expect, it } from 'vitest';

import {
  cjkBigrams,
  extractEntities,
  tokenizeWords,
} from './memory-hybrid-retrieval';
import { buildContextPack, keywordOverlap } from '../memory/context-pack';
import type { MemoryCard } from '../memory/types';

function zhCard(id: string, content: string, extra: Partial<MemoryCard> = {}): MemoryCard {
  return {
    id,
    type: 'episode',
    scope: 'role',
    roleTags: ['coder'],
    content,
    evidence: ['trace:zh-1'],
    confidence: 0.8,
    importance: 0.5,
    lastAccessedAt: '2026-08-25T10:00:00.000Z',
    createdAt: '2026-08-25T10:00:00.000Z',
    accessCount: 1,
    version: 1,
    status: 'active',
    sensitivity: 'normal',
    durability: 'project',
    source: 'user',
    ...extra,
  };
}

describe('TF-0114 (T-P0-6): CJK recall floor', () => {
  it('AC-1: tokenizeWords yields non-empty output for pure Chinese', () => {
    const tokens = tokenizeWords('完成数据库迁移与索引重建');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('数据');
    expect(tokens).toContain('迁移');
  });

  it('AC-1: extractEntities yields non-empty output for pure Chinese', () => {
    const entities = extractEntities('修复登录超时报错，检查回滚脚本');
    expect(entities.size).toBeGreaterThan(0);
    expect(entities.has('修复登录超时报错')).toBe(true);
  });

  it('ASCII tokenization is unchanged (regression guard)', () => {
    expect(tokenizeWords('Fix the LOGIN bug')).toEqual(['fix', 'the', 'login', 'bug']);
    expect(cjkBigrams('Fix the LOGIN bug')).toEqual([]);
  });

  it('AC-2: keywordOverlap > 0 for Chinese task vs Chinese content', () => {
    const overlap = keywordOverlap('完成数据库迁移与索引重建，验证回滚脚本', '数据库迁移');
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeGreaterThanOrEqual(0.35);
  });

  it('AC-2: ASCII keywordOverlap semantics unchanged (regression guard)', () => {
    expect(keywordOverlap('remember the build uses pnpm', 'build system')).toBeCloseTo(0.5, 5);
    expect(keywordOverlap('remember the build uses pnpm', 'completely unrelated words')).toBe(0);
    expect(keywordOverlap('任意内容', '   ')).toBe(0);
  });

  it('AC-2: Chinese taskState crosses the 0.35 selection threshold for a Chinese card', () => {
    const pack = buildContextPack({
      memories: [zhCard('zh-1', '完成数据库迁移与索引重建，验证回滚脚本')],
      roleName: 'coder',
      taskState: '数据库迁移',
    });
    const entry = pack.candidateExplanations?.find((e) => e.cardId === 'zh-1');
    expect(entry).toBeDefined();
    expect(entry?.injectionClass).toBe('may');
    expect(entry?.selected).toBe(true);
  });

  it('AC-2 guard: unrelated Chinese taskState stays below the threshold', () => {
    const pack = buildContextPack({
      memories: [zhCard('zh-2', '完成数据库迁移与索引重建，验证回滚脚本')],
      roleName: 'coder',
      taskState: '优化登录页面样式',
    });
    const entry = pack.candidateExplanations?.find((e) => e.cardId === 'zh-2');
    expect(entry).toBeDefined();
    expect(entry?.selected).toBe(false);
  });
});