/** Evidence persistence boundary: containment and redaction belong at the write point. */
import { writeFile } from 'node:fs/promises';
import { assertInsideRoot } from './path-guard.ts';
import { redactSecretsInText, serializeRedactedJson } from '../security/redact-secrets.ts';

export async function writeEvidenceText(root: string, path: string, text: string): Promise<string> {
  const target = assertInsideRoot(root, path, 'evidence text');
  const redacted = redactSecretsInText(text);
  await writeFile(target, redacted, 'utf8');
  return redacted;
}

export async function writeEvidenceJson(root: string, path: string, value: unknown): Promise<string> {
  const target = assertInsideRoot(root, path, 'evidence JSON');
  const redacted = serializeRedactedJson(value);
  await writeFile(target, redacted, 'utf8');
  return redacted;
}

/** Explicit screenshot exception. Call sites are inventoried by output-boundary.test.ts. */
export async function writeEvidenceBinary(root: string, path: string, bytes: Buffer): Promise<void> {
  const target = assertInsideRoot(root, path, 'binary evidence');
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Binary evidence requires a Buffer');
  await writeFile(target, bytes);
}
