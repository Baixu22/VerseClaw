import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function canonicalEvidenceBytes(bytes) {
  if (bytes.includes(0)) return bytes;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return Buffer.from(text.replace(/\r\n?/gu, '\n'), 'utf8');
  } catch {
    return bytes;
  }
}

export function sha256CanonicalEvidenceFile(path) {
  const bytes = canonicalEvidenceBytes(readFileSync(path));
  return createHash('sha256').update(bytes).digest('hex');
}
