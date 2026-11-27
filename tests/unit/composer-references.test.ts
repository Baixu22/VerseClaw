import { describe, expect, it } from 'vitest';
import { collectDraftReferences, segmentPromptSpans } from '@/lib/composer-references';

const sessions = new Map([
  ['session-123', { key: 'agent:main:review', label: 'Review notes' }],
  ['agent:main:review', { key: 'agent:main:review', label: 'Review notes' }],
  ['ambiguous', null],
]);
const collect = (draft: string) => collectDraftReferences(draft, sessions);

describe('references in an unsent prompt', () => {
  it('finds different resources in one Chinese sentence, in order, and deduplicates aliases', () => {
    const draft = '参考 facebook/react，检查 src/App.tsx:42，使用 npm install zod@3.22.4，主色 #0ea5e9，画布 1280×720，继续 session-123 和 agent:main:review。';
    const refs = collect(draft);
    expect(refs.map(r => r.kind)).toEqual(['repo', 'path', 'npm', 'color', 'size', 'session']);
    expect(refs.map(r => r.label)).toEqual(['facebook/react', 'App.tsx:42', 'zod', '#0EA5E9', '1280 × 720', 'Review notes']);
    expect(refs[2].target).toBe('https://www.npmjs.com/package/zod/v/3.22.4');
    expect(refs[4].badge).toBe('16:9');
  });

  it('distinguishes repositories, pull requests, commits, files and release tags', () => {
    const base = 'https://github.com/acme/widget';
    const refs = collect(`repo:acme/widget, github.com/acme/widget, acme/widget#10, ${base}/pull/11, acme/widget@abcdef1, ${base}/blob/main/src/a.ts#L12-L18, ${base}/releases/tag/v2`);
    expect(refs.map(r => r.kind)).toEqual(['repo', 'issue', 'pr', 'commit', 'file', 'release']);
    expect(refs[4]).toMatchObject({ label: 'a.ts L12-L18', target: base + '/blob/main/src/a.ts#L12-L18' });
    expect(collect('facebook/react')[0]?.kind).toBe('repo');
    expect(collect('src/App.tsx')[0]?.kind).toBe('path');
    expect(collect('on/off and input/output')).toEqual([]);
  });

  it('recognizes a www address without treating an email domain as a page URL', () => {
    expect(collect('www.example.org/guide')).toMatchObject([{ kind: 'website', target: 'https://www.example.org/guide' }]);
    expect(collect('hello@www.example.org')).toMatchObject([{ kind: 'email' }]);
  });

  it('preserves package versions, Figma node links, and Markdown link destinations', () => {
    const refs = collect('pnpm add @scope/ui@2.1, pip install requests==2.32.1, [the layout](https://www.figma.com/design/a12/Settings?node-id=4-12), [docs][guide]\n\n[guide]: https://example.org/a');
    expect(refs.map(r => r.kind)).toEqual(['npm', 'pypi', 'figma', 'website']);
    expect(refs[1].target).toBe('https://pypi.org/project/requests/2.32.1/');
    expect(refs[2]).toMatchObject({ label: 'the layout', detail: 'Figma · 4-12' });
    expect(refs[3]).toMatchObject({ label: 'docs', target: 'https://example.org/a' });
  });

  it('recognizes expanded developer & research references (crates, docker, docs, video, arxiv, cve, linear, jira, email, localhost)', () => {
    const draft = [
      'cargo add tokio@1.40',
      'docker pull postgres:16-alpine',
      'https://react.dev/reference/react/useEffect',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'arXiv:2401.12345',
      'CVE-2025-12345',
      '处理工单 ENG-402 和 https://acme.atlassian.net/browse/OPS-99',
      '联系 dev@example.com 检查 localhost:5173/api',
    ].join(' ');
    const refs = collect(draft);
    expect(refs.map(r => r.kind)).toEqual([
      'crate', 'docker', 'docs', 'video', 'arxiv', 'cve', 'linear', 'jira', 'email', 'ip',
    ]);
    expect(refs[0].target).toBe('https://crates.io/crates/tokio/1.40');
    expect(refs[1]).toMatchObject({ label: 'postgres:16-alpine', target: 'https://hub.docker.com/_/postgres' });
    expect(refs[4].target).toBe('https://arxiv.org/abs/2401.12345');
    expect(refs[5].target).toBe('https://nvd.nist.gov/vuln/detail/CVE-2025-12345');
    expect(refs[6].label).toBe('ENG-402');
    expect(refs[7].label).toBe('OPS-99');
    expect(refs[8].label).toBe('dev@example.com');
    expect(refs[9].target).toBe('http://localhost:5173/api');
  });

  it('keeps literal code and unsafe destinations out of the card and resolves relative file links', () => {
    const draft = ['```sh', 'npm install sample', '#ffaa11', 'https://github.com/acme/fixture', '```',
      '`print("src/example.ts")`', 'API_KEY="sensitive.ts" [bad](javascript:bad) https://name:pwd@example.com/x',
      '[source](./src/main.ts#L12-L14) and `docs/my notes.md`', 'ignore ../outside.ts and ambiguous'].join('\n');
    expect(collect(draft).map(r => [r.kind, r.target])).toEqual([['path', 'src/main.ts'], ['path', 'docs/my notes.md']]);
  });

  it('segments flat prompt text into 1:1 non-overlapping spans for inline composer rendering', () => {
    const draft = '看下 facebook/react 和 #0ea5e9，KEY=sk-secret1234567890';
    const spans = segmentPromptSpans(draft, sessions, []);
    // Concatenating original text of every span must reconstruct draft verbatim (1:1 caret alignment)
    const reconstructed = spans.map(s => (s.kind === 'skill' ? s.text + s.trailingSpace : s.text)).join('');
    expect(reconstructed).toBe(draft);
    expect(spans.filter(s => s.kind === 'reference').map(s => s.kind === 'reference' && s.reference.kind)).toEqual(['repo', 'color']);
    const secretSpan = spans.find(s => s.kind === 'secret');
    expect(secretSpan && secretSpan.kind === 'secret' ? secretSpan.masked : '').toBe('•'.repeat('sk-secret1234567890'.length));
  });
});
