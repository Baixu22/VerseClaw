function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function pathVariants(value) {
  const trimmed = String(value || '').replace(/[\\/]+$/u, '');
  if (!trimmed) return [];
  return [...new Set([
    trimmed.replace(/\\/gu, '/'),
    trimmed.replace(/\//gu, '\\'),
  ])].sort((left, right) => right.length - left.length);
}

function redactPath(value, target, replacement) {
  return pathVariants(target).reduce(
    (current, variant) => current.replace(new RegExp(escapeRegExp(variant), 'giu'), replacement),
    value,
  );
}

export function normalizeCapturedOutput(value, { workspaceRoot, userHome } = {}) {
  if (!value) return '';
  const workspaceRedacted = redactPath(String(value), workspaceRoot, '[workspace]');
  const userHomeRedacted = redactPath(workspaceRedacted, userHome, '[user-home]');
  return `${userHomeRedacted.replace(/\s+$/u, '')}\n`;
}
