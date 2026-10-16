/**
 * MCP result envelope: "summary in content, evidence on disk".
 *
 * Regression guard for the 14x amplification measured on verify_flow
 * (content 644ch → envelope 9,116ch), which the agent loop paid on every turn.
 */
import { describe, expect, it } from 'vitest';
import { createEvidenceRef, errResult, okResult, type ToolResult } from '../src/contracts/index.ts';
import {
  DEFAULT_ENVELOPE_BUDGET,
  EVIDENCE_BACKED_DATA_TOOLS,
  PAYLOAD_IS_ANSWER_TOOLS,
  renderToolResultForTool,
  renderToolResultText,
} from '../src/mcp/result-envelope.ts';

describe('renderToolResultText', () => {
  it.each(['vb_type','vb_append','vb_select','vb_select_values','vb_check','vb_press','vb_pointer','vb_drag'])('retains observation for oversized %s results', tool => {
    const result=okResult('action returned',{session:{id:'s',title:'x'.repeat(20000)},observation:{changed:'unknown',businessOutcome:'unknown',sinceCursor:'epoch:8'},fieldChange:{before:{checked:false},after:{checked:true},changed:true}});
    const rendered=renderToolResultForTool(tool,result);
    expect(rendered.length).toBeLessThanOrEqual(12000);
    expect(JSON.parse(rendered).data).toMatchObject({observation:{sinceCursor:'epoch:8',businessOutcome:'unknown'},fieldChange:{changed:true}});
  });
  it('retains click observation and cursor when the session payload exceeds budget', () => {
    const result = okResult('clicked target',{session:{id:'s',title:'x'.repeat(20000)},observation:{changed:'unknown',beforeUrl:'https://example.test/a',afterUrl:'https://example.test/a',sinceCursor:'capture:3',networkObserved:1,scope:'session-window',businessOutcome:'unknown'}});
    const output = renderToolResultForTool('vb_click',result);
    expect(output.length).toBeLessThanOrEqual(12000);
    expect(JSON.parse(output).data.observation).toMatchObject({sinceCursor:'capture:3',changed:'unknown',businessOutcome:'unknown'});
    const withEvidence = {...result,content:'x'.repeat(800),evidence:[{id:'proof',kind:'summary' as const,path:'.ae/evidence/proof.json',label:'proof',createdAt:'2026-10-08'}]};
    const bounded = JSON.parse(renderToolResultForTool('vb_click',withEvidence));
    expect(bounded.evidence).toEqual(withEvidence.evidence);
    expect(bounded.contentTruncated).toBe(true);
    const fieldResult = {...result,data:{...(result.data as object),targetChange:'changed',fieldChange:{before:{checked:false},after:{checked:true},changed:true}}};
    expect(JSON.parse(renderToolResultForTool('vb_click',fieldResult)).data).toMatchObject({targetChange:'changed',fieldChange:{before:{checked:false},after:{checked:true},changed:true}});
  });
  it('preserves complete compact form data when indentation alone exceeds the soft budget', () => {
    const fields = Array.from({length:8},(_,i)=>({name:`field${i}`,value:'x'.repeat(100),validity:{valid:true,valueMissing:false,typeMismatch:false,patternMismatch:false},form:{id:'A',documentIndex:0}}));
    const result = okResult('Read-only forms',{fields});
    const compact = JSON.stringify(result).length;
    expect(JSON.stringify(result,null,2).length).toBeGreaterThan(compact + 200);
    const output = renderToolResultForTool('vb_forms',result,{maxChars:compact+100,hardMaxChars:compact+200});
    expect(JSON.parse(output).data.fields).toEqual(fields);
    expect(output.length).toBeLessThanOrEqual(compact+100);
  });
  it('leaves small results byte-identical to the plain JSON envelope', () => {
    const result = okResult('done', { a: 1 });
    expect(renderToolResultText(result)).toBe(JSON.stringify(result, null, 2));
  });

  it('omits a large data payload but keeps the summary and a digest', () => {
    const result = okResult('summary of the run', { blob: 'x'.repeat(20_000) });
    const text = renderToolResultText(result);
    expect(text.length).toBeLessThanOrEqual(DEFAULT_ENVELOPE_BUDGET.hardMaxChars);
    expect(text).toContain('summary of the run');
    expect(text).toContain('dataOmitted');
    expect(text).toContain('"blob"');
    // The payload itself must not reach the model.
    expect(text).not.toContain('x'.repeat(500));
  });

  it('keeps evidence pointers even when the payload is dropped', () => {
    const result: ToolResult = {
      ...okResult('verify_flow PASS', { report: 'y'.repeat(20_000) }),
      evidence: [
        createEvidenceRef({
          kind: 'verify',
          label: 'summary',
          path: '.ae/evidence/verify-1/summary.md',
          mimeType: 'text/markdown',
        }),
      ],
    };
    const text = renderToolResultText(result);
    expect(text).toContain('.ae/evidence/verify-1/summary.md');
    expect(text).toContain('"verify"');
  });

  it('falls back to bounded summary + evidence when content itself is huge', () => {
    const result: ToolResult = {
      ...okResult('z'.repeat(30_000), { report: 'y'.repeat(30_000) }),
      evidence: [
        createEvidenceRef({ kind: 'summary', label: 'pack', path: '.ae/evidence/pack-9/summary.md' }),
      ],
    };
    const text = renderToolResultText(result);
    expect(text.length).toBeLessThanOrEqual(DEFAULT_ENVELOPE_BUDGET.hardMaxChars);
    // Evidence pointers must survive truncation.
    expect(text).toContain('.ae/evidence/pack-9/summary.md');
    expect(text).toContain('content truncated');
    // The 30k summary really was cut down, not passed through.
    expect(text).not.toContain('z'.repeat(20_000));
  });

  it('cuts a realistic verify_flow-shaped envelope by at least 70%', () => {
    // Shape mirrors a real verify_flow result measured on
    // scripts/bench/fixtures/browser-checkout: content 644ch, but diagnosis +
    // prComment + evidence pushed the serialized envelope to 9,116ch (14x).
    const result: ToolResult = {
      ...okResult(`# verify_flow PASS\n\n## Collection (ok)\n${'c'.repeat(560)}`, {
        schemaVersion: 1,
        ok: true,
        outcome: 'pass',
        collection: { console: 'ok', network: 'ok', overall: 'ok', notes: [] },
        consoleDiff: { baselineCount: 0, newErrors: [], newWarnings: [], collection: 'ok' },
        networkFailures: { count: 0, failures: [], collection: 'ok' },
        summaryMarkdown: 's'.repeat(477),
        diagnosis: { summaryMarkdown: 'd'.repeat(3000) },
        prComment: 'p'.repeat(2000),
      }),
      evidence: [
        createEvidenceRef({
          kind: 'verify',
          label: 'verify_flow summary',
          path: '.ae/evidence/verify-1/summary.md',
        }),
        createEvidenceRef({
          kind: 'summary',
          label: 'diagnosis',
          path: '.ae/evidence/verify-1/diagnosis.md',
        }),
        createEvidenceRef({
          kind: 'summary',
          label: 'pr-comment',
          path: '.ae/evidence/verify-1/pr-comment.md',
        }),
      ],
    };
    const legacy = JSON.stringify(result, null, 2).length;
    const bounded = renderToolResultText(result).length;
    // Over budget → data replaced by a digest; content + evidence kept.
    expect(legacy).toBeGreaterThan(6000);
    expect(bounded / legacy).toBeLessThanOrEqual(0.3);
    expect(renderToolResultText(result)).toContain('.ae/evidence/verify-1/summary.md');
  });

  it('drops evidence-backed data even when it fits the budget', () => {
    // A character cap is a blunt instrument: a verify_flow result serialized to
    // 5,342 chars slipped under the 6,000 cap and re-sent the whole report.
    const result = okResult('verify_flow PASS', { report: 'r'.repeat(500) });
    const plain = renderToolResultText(result);
    const policed = renderToolResultForTool('vb_verify_flow', result);
    expect(plain).toBe(JSON.stringify(result, null, 2)); // under budget → untouched
    expect(policed).toContain('dataOmitted');
    expect(policed.length).toBeLessThan(plain.length);
  });

  it('leaves payload tools untouched (their data IS the answer)', () => {
    const result = okResult('2 requests', {
      requests: [{ id: 'n-1', url: 'http://x/a' }, { id: 'n-2', url: 'http://x/b' }],
    });
    expect(renderToolResultForTool('vb_network_list', result)).toBe(
      JSON.stringify(result, null, 2),
    );
    expect(renderToolResultForTool('vb_diagnose_page', result)).toBe(
      JSON.stringify(result, null, 2),
    );
  });

  it('declares the evidence-backed tool set explicitly', () => {
    expect([...EVIDENCE_BACKED_DATA_TOOLS].sort()).toEqual(
      [
        'vb_diagnose',
        'vb_evidence_write',
        'vb_pr_comment',
        'vb_record_stop',
        'vb_verify_flow',
      ].sort(),
    );
  });

  it('vb_verify_flow 的缺失 collection.notes 不会崩掉信封', () => {
    // C96/TF-0169: verificationDecision did `report.collection.notes.slice(...)` unguarded, and
    // toTextResult has no try/catch, so a report without notes replaced the ToolResult with a throw
    // (measured 2026-10-14: TypeError: Cannot read properties of undefined (reading 'slice')).
    const base = { schemaVersion: 1, ok: false, outcome: 'fail' as const, selectors: [], expectations: [],
      consoleDiff: { newErrors: [] }, networkFailures: { count: 0 } };
    const shapes: Array<[string, unknown]> = [
      ['missing', { ...base, collection: { console: 'ok', network: 'ok', overall: 'ok' } }],
      ['not-array', { ...base, collection: { console: 'ok', network: 'ok', overall: 'ok', notes: 'oops' } }],
      ['non-string', { ...base, collection: { console: 'ok', network: 'ok', overall: 'ok', notes: [1, 'real'] } }],
      ['odd-selectors', { ...base, selectors: 'nope', expectations: 42, collection: { console: 'ok', network: 'ok', overall: 'ok', notes: [] } }],
      ['console-diff-empty', { ...base, consoleDiff: {}, networkFailures: {} }],
      ['console-diff-null', { ...base, consoleDiff: { newErrors: null }, networkFailures: null }],
    ];
    for (const [label, data] of shapes) {
      const text = renderToolResultForTool('vb_verify_flow', okResult('verify_flow FAIL', data));
      const parsed = JSON.parse(text) as { ok: boolean; data?: { outcome?: string } };
      expect(parsed.ok, label).toBe(true);
      expect(parsed.data?.outcome, label).toBe('fail');
    }
    // A well-formed report keeps its notes.
    const good = JSON.parse(renderToolResultForTool('vb_verify_flow', okResult('verify_flow FAIL',
      { ...base, collection: { console: 'ok', network: 'ok', overall: 'ok', notes: ['a', 'b'] } }))) as
      { data?: { collection?: { notes?: string[] } } };
    expect(good.data?.collection?.notes).toEqual(['a', 'b']);
  });

  it('payload-is-answer 集合被显式声明，且与 evidence-backed 集合不重叠', () => {
    expect([...PAYLOAD_IS_ANSWER_TOOLS].sort()).toEqual(
      ['vb_diagnose_page', 'vb_network_detail', 'vb_network_list', 'vb_network_wait',
        'vb_pages','vb_page_select','vb_page_new','vb_page_close','vb_dialogs','vb_upload','vb_download',
        'vb_type', 'vb_append', 'vb_select', 'vb_select_values', 'vb_check', 'vb_press'].sort(),
    );
    for (const name of PAYLOAD_IS_ANSWER_TOOLS) {
      expect(EVIDENCE_BACKED_DATA_TOOLS.has(name)).toBe(false);
    }
  });

  /**
   * TF-0110：payload 即答案的工具（vb_network_list / vb_network_detail /
   * vb_diagnose_page）在**超预算**时也必须保留有界的 data。
   *
   * 旧行为：体积路径（full > maxChars=6000）对所有工具一律丢 data，
   * 与源码注释「vb_network_list's data.requests *is* the answer」自相矛盾。
   * 实测：同一页面 limit=20 有 20 行可用；limit=30 时模型只收到
   * "26 requests" 且**一行都拿不到**，进而 vb_network_detail（要求用 list 的 id）
   * 根本无法调用。
   */
  it('payload-is-answer 工具超预算时保留有界 data，并声明截断', () => {
    const requests = Array.from({ length: 400 }, (_, i) => ({
      id: `n-${i + 1}`,
      url: `https://example.test/assets/chunk-${i}.js`,
      method: 'GET',
      status: 200,
      failed: false,
    }));
    const result = okResult(`${requests.length} requests`, { requests });

    // 未指定工具名：旧行为（丢 data）
    const generic = renderToolResultText(result);
    expect(generic).toContain('dataOmitted');
    expect(generic).not.toContain('"n-1"');

    // 指定 payload-is-answer 工具：保留有界 data
    const kept = renderToolResultForTool('vb_network_list', result);
    expect(kept.length).toBeLessThanOrEqual(DEFAULT_ENVELOPE_BUDGET.hardMaxChars);
    expect(kept).not.toContain('dataOmitted');
    // 仍然必须能拿到真实 id —— 这正是 network_detail 的前置条件
    expect(kept).toContain('"n-1"');
    // 截断必须被声明，短列表不能被误读为完整列表
    expect(kept).toContain('dataTruncated');
    expect(kept).toContain('entriesTotal');
    expect(kept).toContain('"entriesTotal": 400');
  });

  it('payload-is-answer 工具在预算内时输出与改动前逐字节一致', () => {
    const result = okResult('2 requests', {
      requests: [{ id: 'n-1', url: 'http://x/a', method: 'GET', status: 200, failed: false }],
    });
    expect(renderToolResultForTool('vb_network_list', result)).toBe(JSON.stringify(result, null, 2));
    expect(renderToolResultForTool('vb_network_detail', result)).toBe(JSON.stringify(result, null, 2));
  });

  /**
   * OBS-05 / TF-0110：`dataOmitted.keys` 的数字是**序列化字符数**，字段名却像"条目数"。
   * 真实 run 里模型把 `files: 77` 读成「77 个文件条目」（实际 1 条）。
   * 现在单位写进字段名，且数组直接给 entries。
   */
  it('digest 明确单位：数组给 entries，其它给 chars（不再是裸数字 keys）', () => {
    const result = okResult('summary', {
      files: [{ path: 'summary.md' }],
      packDir: 'D:/x',
      blob: 'x'.repeat(20_000),
    });
    const text = renderToolResultText(result);
    const parsed = JSON.parse(text) as { dataOmitted: { keys?: unknown; fieldSizes?: Record<string, unknown> } };
    expect(parsed.dataOmitted.keys).toBeUndefined();
    const sizes = parsed.dataOmitted.fieldSizes ?? {};
    // 数组：条目数 + 字符数都给
    expect(sizes.files).toEqual({ entries: 1, chars: JSON.stringify([{ path: 'summary.md' }]).length });
    // 非数组：只有字符数，字段名已表明单位
    expect(sizes.packDir).toEqual({ chars: JSON.stringify('D:/x').length });
    expect(sizes.blob).toEqual({ chars: JSON.stringify('x'.repeat(20_000)).length });
  });

  it('never leaks secrets, in content or in data', () => {
    const result = okResult('token=abc123456789', { apiKey: 'sk-abcdefghijklmnop' });
    const text = renderToolResultText(result);
    expect(text).not.toContain('sk-abcdefghijklmnop');
    expect(text).not.toContain('abc123456789');
    expect(text).toContain('[REDACTED]');
  });

  it('preserves the stable error code for failures', () => {
    const text = renderToolResultText(errResult('E_ARG', 'baseline is required', { tool: 'x' }));
    expect(text).toContain('E_ARG');
    expect(text).toContain('baseline is required');
  });

  it('honours a custom budget', () => {
    const result = okResult('summary', { blob: 'x'.repeat(400) });
    const text = renderToolResultText(result, { maxChars: 100, hardMaxChars: 200 });
    expect(text).toContain('dataOmitted');
    expect(text.length).toBeLessThanOrEqual(200);
  });
});
