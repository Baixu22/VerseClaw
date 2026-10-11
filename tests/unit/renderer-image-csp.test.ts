import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('renderer image CSP (#127)', () => {
  it('does not grant network image loads to untrusted renderer content', () => {
    const html = readFileSync('index.html', 'utf8');
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
    const imgSrc = /img-src ([^;]+);/.exec(csp)?.[1] ?? '';
    expect(imgSrc).toContain("'self'");
    expect(imgSrc).toContain('data:');
    expect(imgSrc).toContain('blob:');
    expect(imgSrc).not.toContain('http:');
    expect(imgSrc).not.toContain('https:');
  });
});
