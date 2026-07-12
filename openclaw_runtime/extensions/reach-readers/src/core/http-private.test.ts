import { describe, expect, it } from 'vitest';
import { httpText } from './http.js';

describe('Reach guarded HTTP private targets', () => {
  it.each([
    'http://127.0.0.1/private',
    'http://[::1]/private',
    'http://169.254.169.254/latest/meta-data',
  ])('blocks private user URL %s', async (url) => {
    await expect(httpText(url, { timeoutMs: 1_000 })).rejects.toThrow();
  });
});
