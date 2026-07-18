const REDACTED = '[REDACTED]';
export function sanitizeUiErrorText(input) {
  let text = '';
  if (input instanceof Error) text = String(input.message || 'Unexpected error');
  else if (typeof input === 'string') text = input;
  else if (input == null) text = 'Unexpected error';
  else {
    try { text = JSON.stringify(input); } catch { text = 'Unexpected error'; }
  }
  text = text.split(/\r?\n/u).filter((line) => !/^\s*at\s+\S+/u.test(line)).join('\n');
  text = text.replace(/\bCLAWX_CANARY_[A-Za-z0-9_-]{6,}\b/g, `[${REDACTED}_CANARY]`);
  text = text.replace(/\bOPENCLAW_CANARY_[A-Za-z0-9_-]{6,}\b/g, `[${REDACTED}_CANARY]`);
  text = text.replace(/\bBearer\s+[A-Za-z0-9._+=/-]{12,}\b/gi, `Bearer ${REDACTED}`);
  text = text.replace(/\bsk-proj-[A-Za-z0-9_-]{16,}\b/g, `sk-proj-${REDACTED}`);
  text = text.replace(/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, `sk-ant-${REDACTED}`);
  text = text.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, `sk-${REDACTED}`);
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) text = 'Unexpected error';
  if (text.length > 280) text = `${text.slice(0, 277)}...`;
  return text;
}
export function assertNoStackOrSecret(text) {
  const failures = [];
  if (/\bat\s+\S+/u.test(text)) failures.push('stack-frame');
  if (/\bCLAWX_CANARY_[A-Za-z0-9_-]{6,}\b/.test(text)) failures.push('canary');
  if (/\bsk-[A-Za-z0-9]{20,}\b/.test(text)) failures.push('api-key');
  if (/\bBearer\s+[A-Za-z0-9._+=/-]{12,}\b/i.test(text)) failures.push('bearer');
  return failures;
}
