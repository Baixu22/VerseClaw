import type {
  KnowledgeErrorExperienceCard,
  KnowledgeErrorExperienceEffectivenessAction,
  KnowledgeErrorGuardAdvisory,
  KnowledgeErrorGuardSignal,
  KnowledgeSourceRef,
} from '../host-api/contract';

type ErrorExperienceTarget = {
  targetKind: 'inbox' | 'draft';
  targetId: string;
  sourceRefs: KnowledgeSourceRef[];
  card: KnowledgeErrorExperienceCard;
};

const USER_CORRECTION_PATTERN = /(\u4e0d\u5bf9|\u91cd\u505a|\u6709\u95ee\u9898|\u91cd\u65b0\u6765|\u9519\u4e86|\u4fee\u9519\u4e86|\u5931\u8d25|redo|wrong|not right|incorrect|try again|start over|this failed)/iu;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.flatMap((entry) => (typeof entry === 'string' && entry.trim() ? [entry.trim()] : []))))
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function severityValue(value: unknown): KnowledgeErrorExperienceCard['applicability']['severity'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'blocking' ? value : 'medium';
}

function errorTypeValue(value: unknown): KnowledgeErrorExperienceCard['triggerPattern']['errorType'] {
  if (
    value === 'compile'
    || value === 'runtime'
    || value === 'lint'
    || value === 'test'
    || value === 'logic'
    || value === 'convention'
    || value === 'architecture'
    || value === 'ui-regression'
  ) {
    return value;
  }
  return 'logic';
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function lowerIncludes(haystack: string, needle: string | undefined): boolean {
  if (!needle) return false;
  return haystack.includes(needle.toLowerCase());
}

function patternMatchesFile(pattern: string, filePath: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, '/').toLowerCase();
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  if (!normalizedPattern) return false;
  if (normalizedPattern.includes('*')) {
    const escaped = normalizedPattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`, 'u').test(normalizedPath) || new RegExp(escaped, 'u').test(normalizedPath);
  }
  return normalizedPath.includes(normalizedPattern);
}

export function normalizeErrorExperienceCard(value: unknown): KnowledgeErrorExperienceCard | null {
  const record = asRecord(value);
  if (!record) return null;
  const title = stringValue(record.title);
  const summary = stringValue(record.summary);
  const trigger = asRecord(record.triggerPattern);
  const rootCause = asRecord(record.rootCause);
  const resolution = asRecord(record.resolution);
  const applicability = asRecord(record.applicability);
  const provenance = asRecord(record.provenance);
  if (!title || !summary || !trigger || !rootCause || !resolution || !applicability || !provenance) return null;
  const keywords = stringList(trigger.keywords);
  const filePatterns = stringList(trigger.filePatterns);
  const routeQueries = stringList(trigger.routeQueries);
  const steps = stringList(resolution.steps);
  const createdFrom = asRecord(provenance.createdFrom);
  if (keywords.length === 0 && filePatterns.length === 0 && !stringValue(trigger.stackTraceSignature) && !stringValue(trigger.commandSignature) && routeQueries.length === 0) return null;
  if (!stringValue(rootCause.summary) || steps.length === 0 || !createdFrom || !stringValue(createdFrom.id)) return null;
  return {
    schemaVersion: 1,
    id: stringValue(record.id) ?? `ee_${title.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')}`,
    title,
    summary,
    triggerPattern: {
      errorType: errorTypeValue(trigger.errorType),
      keywords,
      filePatterns,
      ...(stringValue(trigger.stackTraceSignature) ? { stackTraceSignature: stringValue(trigger.stackTraceSignature) } : {}),
      ...(stringValue(trigger.commandSignature) ? { commandSignature: stringValue(trigger.commandSignature) } : {}),
      scenarioDescription: stringValue(trigger.scenarioDescription) ?? summary,
      routeQueries,
    },
    rootCause: {
      summary: stringValue(rootCause.summary)!,
      contributingFactors: stringList(rootCause.contributingFactors),
    },
    resolution: {
      steps,
      ...(stringValue(resolution.antiPattern) ? { antiPattern: stringValue(resolution.antiPattern) } : {}),
      ...(stringValue(resolution.correctPattern) ? { correctPattern: stringValue(resolution.correctPattern) } : {}),
      ...(stringValue(resolution.codeSnippet) ? { codeSnippet: stringValue(resolution.codeSnippet) } : {}),
      verificationCommands: stringList(resolution.verificationCommands),
    },
    applicability: {
      projectScopes: stringList(applicability.projectScopes),
      modules: stringList(applicability.modules),
      roles: stringList(applicability.roles),
      confidence: clamp(numberValue(applicability.confidence, 0.5)),
      severity: severityValue(applicability.severity),
    },
    provenance: {
      createdFrom: {
        kind: createdFrom.kind === 'chat-session'
          || createdFrom.kind === 'task-ledger'
          || createdFrom.kind === 'manual'
          || createdFrom.kind === 'test-run'
          || createdFrom.kind === 'runtime-event'
          ? createdFrom.kind
          : 'manual',
        id: stringValue(createdFrom.id)!,
        ...(stringValue(createdFrom.label) ? { label: stringValue(createdFrom.label) } : {}),
      },
      sourceRefs: Array.isArray(provenance.sourceRefs)
        ? provenance.sourceRefs.flatMap((entry) => {
          const source = asRecord(entry);
          const id = source ? stringValue(source.id) : undefined;
          if (!source || !id) return [];
          return [{
            id,
            kind: stringValue(source.kind) ?? 'manual',
            ...(stringValue(source.label) ? { label: stringValue(source.label) } : {}),
            ...(stringValue(source.path) ? { path: stringValue(source.path) } : {}),
          }];
        })
        : [],
      createdAt: stringValue(provenance.createdAt) ?? new Date().toISOString(),
      ...(stringValue(provenance.lastVerifiedAt) ? { lastVerifiedAt: stringValue(provenance.lastVerifiedAt) } : {}),
    },
    effectiveness: {
      hitCount: Math.max(0, Math.floor(numberValue(asRecord(record.effectiveness)?.hitCount, 0))),
      acceptedCount: Math.max(0, Math.floor(numberValue(asRecord(record.effectiveness)?.acceptedCount, 0))),
      dismissedCount: Math.max(0, Math.floor(numberValue(asRecord(record.effectiveness)?.dismissedCount, 0))),
      preventedFailureCount: Math.max(0, Math.floor(numberValue(asRecord(record.effectiveness)?.preventedFailureCount, 0))),
      staleCount: Math.max(0, Math.floor(numberValue(asRecord(record.effectiveness)?.staleCount, 0))),
    },
  };
}

function signalText(signal: KnowledgeErrorGuardSignal): string {
  return [
    signal.text,
    signal.command,
    signal.stackTrace,
    ...(signal.filePaths ?? []),
  ].filter(Boolean).join('\n').toLowerCase();
}

function matchOne(target: ErrorExperienceTarget, signal: KnowledgeErrorGuardSignal): KnowledgeErrorGuardAdvisory | null {
  const text = signalText(signal);
  const whyMatched: string[] = [];
  let score = 0;
  const keywordHits = target.card.triggerPattern.keywords.filter((keyword) => lowerIncludes(text, keyword));
  if (keywordHits.length > 0) {
    score += Math.min(0.36, keywordHits.length * 0.09);
    whyMatched.push(`keyword: ${keywordHits.slice(0, 4).join(', ')}`);
  }
  const routeHits = target.card.triggerPattern.routeQueries.filter((query) => lowerIncludes(text, query));
  if (routeHits.length > 0) {
    score += Math.min(0.18, routeHits.length * 0.06);
    whyMatched.push(`route query: ${routeHits[0]}`);
  }
  if (lowerIncludes(text, target.card.triggerPattern.stackTraceSignature)) {
    score += 0.42;
    whyMatched.push('stack trace signature');
  }
  if (lowerIncludes(text, target.card.triggerPattern.commandSignature)) {
    score += 0.26;
    whyMatched.push('command signature');
  }
  const fileHits = target.card.triggerPattern.filePatterns.filter((pattern) => (
    (signal.filePaths ?? []).some((path) => patternMatchesFile(pattern, path))
    || lowerIncludes(text, pattern)
  ));
  if (fileHits.length > 0) {
    score += Math.min(0.28, fileHits.length * 0.1);
    whyMatched.push(`file pattern: ${fileHits.slice(0, 3).join(', ')}`);
  }
  if (signal.kind === 'user-correction' || USER_CORRECTION_PATTERN.test(signal.text)) {
    score += 0.14;
    whyMatched.push('user correction signal');
  }
  if (
    signal.kind === 'test-failure' && target.card.triggerPattern.errorType === 'test'
    || signal.kind === 'lint-failure' && target.card.triggerPattern.errorType === 'lint'
    || signal.kind === 'build-failure' && target.card.triggerPattern.errorType === 'compile'
    || signal.kind === 'runtime-error' && target.card.triggerPattern.errorType === 'runtime'
  ) {
    score += 0.16;
    whyMatched.push(`error type: ${target.card.triggerPattern.errorType}`);
  }
  if (score < 0.2) return null;
  return {
    id: `advisory_${target.targetKind}_${target.targetId}_${target.card.id}`,
    targetKind: target.targetKind,
    targetId: target.targetId,
    cardId: target.card.id,
    title: target.card.title,
    summary: target.card.summary,
    whyMatched,
    rootCause: target.card.rootCause.summary,
    recommendedResolution: target.card.resolution.steps,
    confidence: clamp((target.card.applicability.confidence * 0.4) + (score * 0.6)),
    severity: target.card.applicability.severity,
    sourceRefs: target.sourceRefs,
    provenance: {
      createdFrom: target.card.provenance.createdFrom,
      source: 'knowledge-error-experience',
    },
  };
}

export function matchErrorExperienceCards(targets: ErrorExperienceTarget[], signal: KnowledgeErrorGuardSignal, limit = 3): KnowledgeErrorGuardAdvisory[] {
  const cappedLimit = Math.max(1, Math.min(Math.floor(limit), 10));
  return targets
    .flatMap((target) => {
      const advisory = matchOne(target, signal);
      return advisory ? [advisory] : [];
    })
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, cappedLimit);
}

export function updateErrorExperienceEffectiveness(
  card: KnowledgeErrorExperienceCard,
  action: KnowledgeErrorExperienceEffectivenessAction,
): KnowledgeErrorExperienceCard {
  const effectiveness = { ...card.effectiveness };
  if (action === 'hit') effectiveness.hitCount += 1;
  if (action === 'accepted') effectiveness.acceptedCount += 1;
  if (action === 'dismissed') effectiveness.dismissedCount += 1;
  if (action === 'prevented-failure') effectiveness.preventedFailureCount += 1;
  if (action === 'stale') effectiveness.staleCount += 1;
  return { ...card, effectiveness };
}
