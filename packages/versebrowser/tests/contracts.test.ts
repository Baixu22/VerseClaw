import { describe, expect, it } from 'vitest';
import {
  createEvidenceRef,
  errResult,
  okResult,
} from '../src/contracts/index';

describe('contracts tool results', () => {
  it('builds ok result with optional data and evidence', () => {
    const evidence = createEvidenceRef({ kind: 'screenshot', label: 'shot', path: '/tmp/a.png', mimeType: 'image/png', size: 10 });
    const result = okResult('saved', { path: '/tmp/a.png' }, [evidence]);
    expect(result.ok).toBe(true);
    expect(result.content).toBe('saved');
    expect(result.evidence?.[0].kind).toBe('screenshot');
    expect(result.error).toBeUndefined();
  });

  it('builds err result with code and message', () => {
    const result = errResult('E_NAV', 'bad url', { url: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('E_NAV');
    expect(result.error?.details).toEqual({ url: 'x' });
  });

  it('createEvidenceRef stamps id and createdAt', () => {
    const ref = createEvidenceRef({ kind: 'summary', label: 's' });
    expect(ref.id).toMatch(/^ev-summary-/);
    expect(ref.createdAt).toBeTruthy();
  });
});
