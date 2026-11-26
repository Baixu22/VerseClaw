---
title: openclaw_runtime/src/runtime-core/memory-tokenization.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T04:49:07.401Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: openclaw_runtime/src/runtime-core/memory-tokenization.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
/** Shared no-segmenter CJK fallback. Kept free of memory-store/runtime imports. */
export const CJK_RUN_RE = /[\u4e00-\u9fff]{2,}/g;

export function cjkBigrams(text: string): string[] {
  const grams: string[] = [];
  for (const run of text.match(CJK_RUN_RE) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      grams.push(run.slice(i, i + 2));
    }
  }
  return grams;
}

~~~
