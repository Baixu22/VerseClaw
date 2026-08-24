import { describe, expect, it } from 'vitest';
import { remarkSecretHighlight } from '@/pages/Chat/remark-secret-highlight';

interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

function run(tree: Node): Node {
  const transform = remarkSecretHighlight();
  transform(tree);
  return tree;
}

describe('remarkSecretHighlight', () => {
  it('splits paragraph text around matches', () => {
    const key = 'sk-' + 'a'.repeat(24);
    const tree = run({
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'before ' + key + ' after' }] },
      ],
    });
    const paragraph = tree.children![0];
    expect(paragraph.children!.map((child) => child.type)).toEqual(['text', 'secretText', 'text']);
    expect(paragraph.children![1].value).toBe(key);
    expect(paragraph.children![0].value).toBe('before ');
    expect(paragraph.children![2].value).toBe(' after');
  });

  it('handles inlineCode and leaves fenced code untouched', () => {
    const key = 'sk-' + 'b'.repeat(24);
    const tree = run({
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'inlineCode', value: key }] },
        { type: 'code', value: key },
      ],
    });
    expect(tree.children![0].children!.map((child) => child.type)).toEqual(['secretText']);
    const code = tree.children![1];
    expect(code.children).toBeUndefined();
    expect(code.value).toBe(key);
  });

  it('leaves clean text untouched', () => {
    const tree = run({
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'hello world' }] }],
    });
    expect(tree.children![0].children!).toHaveLength(1);
    expect(tree.children![0].children![0].type).toBe('text');
  });

  it('respects the per-node cap', () => {
    const key = 'sk-' + 'c'.repeat(24);
    const value = Array.from({ length: 60 }, () => key).join(' ');
    const tree = run({
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', value }] }],
    });
    const secretNodes = tree.children![0].children!.filter((child) => child.type === 'secretText');
    expect(secretNodes).toHaveLength(50);
  });
});
