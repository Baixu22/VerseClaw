import { findSecretRanges } from '@shared/privacy/secret-shapes';

/**
 * remark plugin: splits `text` and `inlineCode` nodes at secret-shape matches
 * into custom `secretText` nodes, which the markdown `components` map renders
 * as red warning spans. Fenced code blocks are intentionally untouched (v1).
 *
 * Pure tree transform, no I/O; the scan cost is paid once per finalized
 * message render (callers memoize / skip streaming text).
 */

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  [key: string]: unknown;
}

export function remarkSecretHighlight() {
  return (tree: unknown): void => {
    const walk = (node: MdNode): void => {
      if (node.type === 'code') return; // fenced blocks stay raw in v1
      if (!node.children || node.children.length === 0) return;
      const next: MdNode[] = [];
      for (const child of node.children) {
        if (
          (child.type === 'text' || child.type === 'inlineCode')
          && typeof child.value === 'string'
          && child.value.length > 0
        ) {
          const ranges = findSecretRanges(child.value, 50);
          if (ranges.length > 0) {
            let cursor = 0;
            for (const range of ranges) {
              if (range.start > cursor) {
                next.push({ ...child, value: child.value.slice(cursor, range.start) });
              }
              next.push({ type: 'secretText', value: child.value.slice(range.start, range.end) });
              cursor = range.end;
            }
            if (cursor < child.value.length) {
              next.push({ ...child, value: child.value.slice(cursor) });
            }
            continue;
          }
        }
        next.push(child);
        walk(child);
      }
      node.children = next;
    };
    walk(tree as MdNode);
  };
}
