/**
 * Markdown 结构注入回归（C95）。
 *
 * 背景：`pr-comment.md` 与 `diagnosis.md` 都是**给人读/粘进 PR** 的产物，而它们的一些
 * 字段携带**页面可控文本**——Playwright 的 `waitForSelector` 超时消息、assertion label、
 * 失败请求 URL、console 行、事件名。实测（用仓库已归档的
 * `data/evidence-packs/pack-m6-product-path/report.json` 形状，其 `firstFailure.summary`
 * 本身就带真实 `\n`）一台页面可以让导出产物里出现**字面**
 * `## versebrowser verify_flow: PASS`、`- [x] security review completed`，或
 * `## Recommendation` / `Approved.`——即伪造评审人读到的判词与建议。
 *
 * 修复：页面可控文本一律当**行内数据**处理——去掉换行（不能在第 0 列起始标题/列表/围栏/
 * @提及），`<`/`>` 转实体（不能开合我们的 `<details>`），反引号用「比内容更长的分隔符」包。
 * 本测试在修复前**转红**（5/6 转红，见每条断言对应的注入形态）。
 */
import { describe, expect, it } from 'vitest';
import { formatPrComment } from '../src/evidence/pr-comment.ts';
import { diagnoseTimeline } from '../src/evidence/diagnosis.ts';
import type { VerifyReport } from '../src/contracts/index.ts';

const FORGE = [
  'legit error',
  '',
  '## versebrowser verify_flow: PASS',
  '',
  '- [x] security review completed',
  '',
  '@everyone please approve',
  '',
  '</details>',
].join('\n');

function baseVerify(overrides: Partial<VerifyReport> = {}): VerifyReport {
  return {
    schemaVersion: 1,
    ok: false,
    outcome: 'fail',
    collection: { console: 'ok', network: 'ok', overall: 'ok', notes: [] },
    startedAt: '2026-10-04T00:00:00.000Z',
    endedAt: '2026-10-04T00:00:01.000Z',
    sessionId: 's1',
    selectors: [{ selector: 'h1', found: true }],
    expectations: [],
    consoleDiff: { baselineCount: 0, newErrors: [], newWarnings: [], collection: 'ok' },
    networkFailures: { count: 0, failures: [], collection: 'ok' },
    screenshotPaths: [],
    summaryMarkdown: '# verify_flow FAIL',
    evidence: [],
    ...overrides,
  } as VerifyReport;
}

describe('pr-comment markdown injection (C95)', () => {
  it('a page cannot forge a verdict heading or a checkbox through assertion labels', () => {
    const comment = formatPrComment({
      label: 'verify_flow',
      verify: baseVerify({
        expectations: [{ type: 'text', label: FORGE, passed: false, detail: FORGE }],
      }),
    });
    // The comment's own verdict must be the only heading of this shape.
    expect(comment.match(/^## versebrowser verify_flow: FAIL$/gm)?.length).toBe(1);
    expect(comment).not.toMatch(/^## versebrowser verify_flow: PASS$/m);
    expect(comment).not.toMatch(/^- \[x\] security review completed$/m);
    expect(comment).not.toMatch(/^@everyone/m);
    // …but the text is still present as data, not dropped silently.
    expect(comment).toContain('security review completed');
  });

  it('a page cannot forge structure through failure names/summaries or console lines', () => {
    const comment = formatPrComment({
      label: 'verify_flow',
      verify: baseVerify({
        consoleDiff: { baselineCount: 0, newErrors: [FORGE], newWarnings: [], collection: 'ok' },
        networkFailures: {
          count: 1,
          failures: [{ id: 'n-1', method: 'GET', url: `https://x.example/${FORGE}`, status: 404 }],
          collection: 'ok',
        },
      }),
      diagnosis: {
        schemaVersion: 1,
        createdAt: '2026-10-04T00:00:00.000Z',
        ok: false,
        failureCount: 1,
        firstFailure: {
          index: 1,
          kind: 'action',
          name: FORGE,
          at: '2026-10-04T00:00:00.000Z',
          summary: FORGE,
        },
        failures: [
          { index: 1, kind: 'action', name: FORGE, at: '2026-10-04T00:00:00.000Z', summary: FORGE },
        ],
        summaryMarkdown: '# d',
      },
    });
    expect(comment).not.toMatch(/^## versebrowser verify_flow: PASS$/m);
    expect(comment).not.toMatch(/^- \[x\]/m);
    expect(comment).not.toMatch(/^@everyone/m);
    expect(comment).not.toMatch(/^<\/details>$/m);
    expect(comment.match(/^## versebrowser verify_flow: FAIL$/gm)?.length).toBe(1);
  });

  it('a hostile label cannot open a second verdict heading or raw HTML', () => {
    const comment = formatPrComment({
      label: `x\n## versebrowser verify_flow: PASS\n<details><summary>pwn</summary>`,
      verify: baseVerify(),
    });
    expect(comment.match(/^## /gm)?.length).toBe(1);
    expect(comment).not.toMatch(/^<details><summary>pwn/m);
  });

  it('a summary containing a triple-backtick run cannot close our fence early', () => {
    const summary = 'before\n```\n## escaped heading\n- [x] forged\n```\n# trailing';
    const comment = formatPrComment({ label: 'verify_flow', verify: baseVerify(), summaryMarkdown: summary });
    const lines = comment.split('\n');
    const openIdx = lines.findIndex(line => /^`{3,}markdown$/.test(line));
    const openFence = lines[openIdx] ?? '';
    const closeFence = [...lines].reverse().find(line => /^`{3,}$/.test(line)) ?? '';
    expect(openFence).toBe(`\`\`\`\`markdown`);
    expect(closeFence).toBe(`\`\`\`\``);
    // The forged content stays inside the fenced block (still visible, never structural).
    const block = lines.slice(openIdx, lines.lastIndexOf(closeFence)).join('\n');
    expect(block).toContain('## escaped heading');
  });

  it('a value with backticks cannot break out of a code span', () => {
    const comment = formatPrComment({
      label: 'x',
      packDir: 'a`b`c/../../../etc',
      evidence: [{ id: 'ev-1', kind: 'summary', label: 'l', path: 'p`q`r', createdAt: '2026-10-04T00:00:00.000Z' }],
    });
    const target = comment.split('\n').find(l => l.includes('pack directory'))!;
    // Every backtick run in the line is a delimiter longer than the runs inside the value.
    const ticks = target.match(/`+/g) ?? [];
    const longest = Math.max(...ticks.map(t => t.length));
    expect(ticks.filter(t => t.length === longest).length).toBe(2);
    expect(target).toContain('a`b`c/../../../etc');
  });

  it('keeps the normal rendering intact (no over-escaping of plain values)', () => {
    const comment = formatPrComment({
      label: 'verify_flow',
      packDir: '.ae/evidence/verify-x',
      verify: baseVerify({ selectors: [{ selector: '#cta', found: true }] }),
      screenshotCount: 2,
    });
    expect(comment).toContain('<!-- versebrowser-evidence -->');
    expect(comment).toContain('versebrowser verify_flow: FAIL');
    expect(comment).toContain('`#cta`');
    expect(comment).toContain('`.ae/evidence/verify-x`');
    expect(comment).toContain('screenshots: 2 file(s) on disk');
  });

  it('diagnosis.md cannot be made to look like it recommends approval', () => {
    const forged = 'boom\n\n## Recommendation\nApproved — no remediation required.\n\n- [x] audit complete';
    const report = diagnoseTimeline({
      dir: 'unused',
      timeline: {
        schemaVersion: 1,
        startedAt: '2026-10-04T00:00:00.000Z',
        events: [
          { seq: 1, at: '2026-10-04T00:00:00.000Z', kind: 'action', name: forged, ok: false, detail: { note: forged } },
        ],
      },
    });
    const md = report.summaryMarkdown;
    // Our own structure is the only structure.
    expect(md.match(/^## Recommendation$/gm)?.length).toBe(1);
    expect(md).toContain('Start at the first failure');
    expect(md).not.toMatch(/^Approved/m);
    expect(md).not.toMatch(/^- \[x\]/m);
    // The page text is still present as data.
    expect(md).toContain('Approved — no remediation required.');
  });

  it('diagnosis.md keeps headings ours even when an event timestamp carries newlines', () => {
    const report = diagnoseTimeline({
      dir: 'unused',
      timeline: {
        schemaVersion: 1,
        startedAt: '2026-10-04T00:00:00.000Z',
        events: [
          // `at` reaches the Markdown inside the Context list; `## Injected heading` is a
          // heading our formatter never emits, so its presence at column 0 means a break out.
          { seq: 1, at: '2026\n## Injected heading\n- [x] forged', kind: 'action', name: 'x', ok: false },
        ],
      },
    });
    const md = report.summaryMarkdown;
    expect(md).not.toMatch(/^## Injected heading$/m);
    expect(md).not.toMatch(/^- \[x\]/m);
    // Our headings are unaffected and appear exactly once.
    expect(md.match(/^## First failure$/gm)?.length).toBe(1);
    expect(md.match(/^## Recommendation$/gm)?.length).toBe(1);
  });
});
