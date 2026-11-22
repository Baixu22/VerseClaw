import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyKnowledgeSupportReview, bindKnowledgeQaClaims, validateKnowledgeQaOutput, validateKnowledgeSupportOutput } from '@electron/services/knowledge-evidence-qa';

const hash = (text: string) => 'sha256:' + createHash('sha256').update(text).digest('hex');
const prefix = '---\n标题：部署\n---\n';
const content = '网关😀端口为8080。\n审阅后应用。\n';
const source = { id: 'port', title: 'Port', lookup: 'port.md', excerpt: content, content,
  citation: { refId: 'pin-port', owner: 'memory-wiki', subjectId: 'port.md', revision: '2', sourceRefs: ['port'],
    contentDigest: hash(content), sourceRef: { schema: 'SourceRef/v2' as const, domain: 'wiki' as const,
      authorityId: 'memory-wiki', namespaceId: 'fixture', subjectId: 'port.md', revision: '2',
      sourceDigest: hash(prefix + content), policyEpoch: hash('policy'), locator: { coordinateSpace: 'raw-source-utf8-v1' as const,
        startByte: Buffer.byteLength(prefix), endByteExclusive: Buffer.byteLength(prefix + content), startLine: 4, endLine: 5 } } } };
const raw = { claims: [{ kind: 'source', text: '网关端口为8080。', citations: [{ sourceId: 'pin-port', quote: '端口为8080。' }] }], unknowns: [] };
const bound = () => bindKnowledgeQaClaims(validateKnowledgeQaOutput(JSON.stringify(raw), [source]), [source]);

describe('Project RAG answer/citation contracts', () => {
  it('binds a UTF-8 raw quote range and keeps quote/pin checks distinct from semantic support', () => {
    const claim = bound()[0], citation = claim.citations[0], range = citation.sourceRef.locator!;
    expect(Buffer.from(prefix + content).subarray(range.startByte, range.endByteExclusive).toString()).toBe(citation.quote);
    expect(range.startLine).toBe(4); expect(range.endLine).toBe(4);
    expect(citation.sourceDigest).toBe(hash(prefix + content));
    expect(citation.chunkDigest).toBe(hash(content)); expect(citation.quoteDigest).toBe(hash(citation.quote));
    expect(claim.evidenceStatus).toMatchObject({ exactQuote: 'verified', sourcePin: 'verified', semanticSupport: 'unverified' });
  });
  it('refuses changed pins and a quote that splits a Unicode surrogate pair', () => {
    expect(() => bindKnowledgeQaClaims(validateKnowledgeQaOutput(JSON.stringify(raw), [source]), [{ ...source, content: content + 'changed' }])).toThrow('changed');
    const broken = { ...raw, claims: [{ ...raw.claims[0], citations: [{ sourceId: 'pin-port', quote: '\ude00端口' }] }] };
    expect(() => bindKnowledgeQaClaims(validateKnowledgeQaOutput(JSON.stringify(broken), [source]), [source])).toThrow('raw range');
  });
  it('returns unknown for strict unsupported/conflicting facts, while preserving uncited open knowledge', () => {
    const claims = bound();
    const unsupported = { answerability: 'insufficient' as const, claims: [{ index: 0, status: 'unsupported' as const, reason: 'The quote states 8080 rather than the proposed value.' }] };
    expect(applyKnowledgeSupportReview(claims, unsupported, 'judge-1', 'strict')).toMatchObject({ claims: [], unknowns: expect.arrayContaining([unsupported.claims[0].reason]) });
    const general = bindKnowledgeQaClaims(validateKnowledgeQaOutput(JSON.stringify({ claims: [{ kind: 'general', text: 'Ports identify network services.', citations: [] }], unknowns: [] }), [], 'open'), []);
    expect(general[0].citations).toEqual([]); expect(general[0].evidenceStatus.semanticSupport).toBe('not-applicable');
    expect(applyKnowledgeSupportReview([...claims, ...general], unsupported, 'judge-1', 'open').claims).toEqual(general);
    expect(applyKnowledgeSupportReview(claims, { ...unsupported, answerability: 'conflicting' }, 'judge-1', 'strict').claims).toEqual([]);
  });
  it('records agent support only after a complete separate verdict', () => {
    const claims = bound();
    const review = validateKnowledgeSupportOutput(JSON.stringify({ answerability: 'answerable', claims: [{ index: 0, status: 'supported', reason: 'The deployment value is stated in the cited source.' }] }), claims);
    const answer = applyKnowledgeSupportReview(claims, review, 'judge-2', 'strict');
    expect(answer.claims[0].evidenceStatus).toMatchObject({ semanticSupport: 'supported', verifier: { actor: 'knowledge-claim-support', driven_by: 'agent', runId: 'judge-2' } });
    expect(() => validateKnowledgeSupportOutput(JSON.stringify({ ...review, claims: [] }), claims)).toThrow();
    expect(() => validateKnowledgeSupportOutput(JSON.stringify({ ...review, claims: [review.claims[0], review.claims[0]] }), claims)).toThrow();
  });
  it('rejects forged citations and strict general knowledge', () => {
    expect(() => validateKnowledgeQaOutput(JSON.stringify({ claims: [{ kind: 'general', text: 'Guess', citations: [] }], unknowns: [] }), [])).toThrow();
    expect(() => validateKnowledgeQaOutput(JSON.stringify({ claims: [{ kind: 'inference', text: 'Guess', citations: raw.claims[0].citations }], unknowns: [] }), [source], 'open')).toThrow();
  });
});
