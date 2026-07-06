export function normalizeForSearch(value) {
  return String(value ?? '').replace(/\\+/g, '/');
}

function isLikelyApiUrlRef(ref) {
  const slash = ref.indexOf('/');
  if (slash <= 0) {
    return false;
  }
  const prefix = ref.slice(0, slash);
  return /\./.test(prefix);
}

export function canonicalizeModelRef(ref) {
  if (typeof ref !== 'string') {
    return null;
  }
  const trimmed = ref.trim();
  if (!trimmed || /^(https?|file|node):/.test(trimmed) || isLikelyApiUrlRef(trimmed)) {
    return null;
  }
  if (trimmed.includes('/')) {
    return trimmed;
  }
  if (/^deepseek[-_]/i.test(trimmed)) {
    return `deepseek/${trimmed}`;
  }
  return trimmed;
}

function addModelRef(refs, value) {
  const canonical = canonicalizeModelRef(value);
  if (canonical) {
    refs.add(canonical);
  }
}

function addProviderModelRef(refs, provider, modelId) {
  if (typeof modelId !== 'string' || !modelId.trim()) {
    return;
  }
  if (typeof provider === 'string' && provider.trim() && !modelId.includes('/')) {
    addModelRef(refs, `${provider.trim()}/${modelId.trim()}`);
    return;
  }
  addModelRef(refs, modelId);
}

export function scanModelRefsInText(text) {
  const refs = new Set();
  const rawText = String(text ?? '');
  for (const match of rawText.matchAll(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.:-]+)\b/g)) {
    const ref = match[1];
    if (ref.includes('deepseek') || ref.includes('gpt') || ref.includes('claude') || ref.includes('gemini')) {
      addModelRef(refs, ref);
    }
  }
  for (const match of rawText.matchAll(/"model"\s*:\s*"([^"]+)"/g)) {
    addModelRef(refs, match[1]);
  }
  for (const match of rawText.matchAll(/"modelRef"\s*:\s*"([^"]+)"/g)) {
    addModelRef(refs, match[1]);
  }
  return [...refs].sort();
}

function readJsonLineRole(line) {
  try {
    const parsed = JSON.parse(line);
    return parsed?.message?.role ?? parsed?.role ?? null;
  } catch {
    return null;
  }
}

function scanModelRefsInJsonLine(line) {
  let parsed = null;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  const refs = new Set();
  if (parsed?.traceSchema === 'openclaw-trajectory' || typeof parsed?.modelId === 'string') {
    addProviderModelRef(refs, parsed?.provider, parsed?.modelId);
    addProviderModelRef(refs, parsed?.provider, parsed?.modelRef);
    return [...refs].sort();
  }

  addProviderModelRef(refs, parsed?.message?.provider ?? parsed?.provider, parsed?.message?.model ?? parsed?.model);
  addProviderModelRef(refs, parsed?.message?.provider ?? parsed?.provider, parsed?.message?.modelRef ?? parsed?.modelRef);
  return refs.size > 0 ? [...refs].sort() : null;
}

export function summarizeRunRelevantText(text, needles) {
  const normalizedNeedles = needles.map(normalizeForSearch).filter(Boolean);
  const refs = new Set();
  let containsRunWorkspace = false;
  let relevantLineCount = 0;
  let inRelevantTurn = false;

  for (const line of String(text ?? '').split(/\r?\n/).filter(Boolean)) {
    const role = readJsonLineRole(line);
    const normalizedLine = normalizeForSearch(line);
    const containsNeedle = normalizedNeedles.some((needle) => normalizedLine.includes(needle));

    if (role === 'user') {
      inRelevantTurn = containsNeedle;
    }

    const relevant = containsNeedle || inRelevantTurn;
    if (!relevant) {
      continue;
    }

    containsRunWorkspace = true;
    relevantLineCount += 1;
    const lineModelRefs = scanModelRefsInJsonLine(line) ?? scanModelRefsInText(line);
    for (const ref of lineModelRefs) {
      refs.add(ref);
    }
  }

  return {
    containsRunWorkspace,
    relevantLineCount,
    modelRefs: [...refs].sort(),
  };
}
