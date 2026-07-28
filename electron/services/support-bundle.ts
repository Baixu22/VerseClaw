/**
 * FP-P1-06: sanitized support bundle export.
 *
 * One click produces a single JSON archive that is safe to send out:
 * versions, gateway state, provider TYPES + verification state (never keys),
 * saved-vs-runtime-effective flags mirrored from the live gateway child,
 * workspace/session lineage, budget/observability counters, and journal
 * summaries (paths + outcomes only, never file contents).
 *
 * Hard locks (task doc):
 *  - redaction failure ⇒ export failure (never "best-effort sanitized")
 *  - no file contents / diff bodies
 *  - no auto-upload: the file is written locally and the path returned
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import { getAllSettings } from '../utils/store';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { listProviderAccounts } from './providers/provider-store';
import { getProviderService } from './providers/provider-service';
import { getDcsPreviewState } from './dcs-prod-flags-api';
import { logger } from '../utils/logger';

export type SupportBundleRedactionFinding = { type: string; hits: number };

export type SupportBundleResult = {
  success: boolean;
  path?: string;
  redaction?: {
    findings: SupportBundleRedactionFinding[];
    totalHits: number;
    verified: boolean;
  };
  truncated?: string[];
  error?: string;
};

const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
const MAX_LOG_TAIL_LINES = 300;

/**
 * Redaction patterns. Each replaces with a typed placeholder. Applied to the
 * SERIALIZED bundle so nothing escapes via nested fields.
 */
const REDACTION_PATTERNS: Array<{ type: string; pattern: RegExp; replacement: string }> = [
  { type: 'openai-style-key', pattern: /sk-[A-Za-z0-9_-]{8,}/g, replacement: '[REDACTED:api-key]' },
  { type: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9_-]{8,}/g, replacement: '[REDACTED:api-key]' },
  { type: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED:token]' },
  { type: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED:aws-key]' },
  { type: 'slack-token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: '[REDACTED:token]' },
  {
    type: 'bearer-token',
    pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replacement: 'Bearer [REDACTED:token]',
  },
  {
    type: 'env-assignment',
    pattern: /\b([A-Z][A-Z0-9_]{2,}(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*=\s*[^\s"',;\\[\]]{8,}/g,
    replacement: '$1=[REDACTED:env-value]',
  },
  {
    type: 'windows-user-path',
    pattern: /([A-Za-z]:\\+Users\\+)[^\\/:*?"<>|,\s[\]]+/g,
    replacement: '$1[REDACTED:user]',
  },
  {
    type: 'home-user-path',
    pattern: /(\/(?:home|Users)\/)[^\s/:*?"<>|,[\]]+/g,
    replacement: '$1[REDACTED:user]',
  },
];

/** Pure: redact a serialized bundle. Exported for unit tests. */
export function redactSupportBundleText(text: string): {
  sanitized: string;
  findings: SupportBundleRedactionFinding[];
} {
  let sanitized = text;
  const findings: SupportBundleRedactionFinding[] = [];
  for (const { type, pattern, replacement } of REDACTION_PATTERNS) {
    const matches = sanitized.match(pattern);
    const hits = matches?.length ?? 0;
    if (hits > 0) {
      sanitized = sanitized.replace(pattern, replacement);
    }
    findings.push({ type, hits });
  }
  return { sanitized, findings };
}

/**
 * Pure: post-redaction verification. Returns the types that STILL match after
 * redaction — any entry means the redaction failed and export must abort.
 */
export function verifyRedaction(sanitized: string): string[] {
  const stillMatching: string[] = [];
  for (const { type, pattern } of REDACTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(sanitized)) stillMatching.push(type);
    pattern.lastIndex = 0;
  }
  return stillMatching;
}

function truncateTail(text: string, lines: number): string {
  const split = text.split('\n');
  return split.length <= lines ? text : split.slice(-lines).join('\n');
}

export type SupportBundleContext = {
  gatewayManager: GatewayManager;
};

async function collectRuntimeMirror(gatewayManager: GatewayManager): Promise<Record<string, unknown>> {
  // Mirror the CHILD's own counters/flags — not the main-process view.
  try {
    if (gatewayManager.getStatus().state !== 'running') {
      return { available: false, reason: 'gateway-not-running' };
    }
    const ack = (await gatewayManager.rpc('runtime.flags.ack', {}, 15_000)) as Record<string, unknown>;
    return {
      available: true,
      childPid: ack.childPid,
      gatewayGeneration: ack.gatewayGeneration,
      effectiveFlags: ack.effectiveFlags,
      configSource: ack.configSource,
      degradedReason: ack.degradedReason,
      turnEffectProbe: ack.turnEffectProbe,
      injectionBudget: ack.injectionBudget,
      runtimeBuildOrConfigHash: ack.runtimeBuildOrConfigHash,
    };
  } catch (error) {
    return { available: false, reason: String(error) };
  }
}

async function collectJournalSummary(workspaceRoot: string | undefined): Promise<Record<string, unknown>> {
  // Paths + counts only — never snapshot contents (hard lock).
  if (!workspaceRoot) return { available: false, reason: 'no-workspace' };
  try {
    const journalRoot = join(workspaceRoot, '.openclaw', 'journal');
    const sessions = await readdir(journalRoot).catch(() => [] as string[]);
    const summary: Array<Record<string, unknown>> = [];
    for (const session of sessions.slice(0, 20)) {
      const dir = join(journalRoot, session);
      const files = await readdir(dir).catch(() => [] as string[]);
      const metas = files.filter((name) => name.endsWith('.meta.json'));
      const entries: Array<Record<string, unknown>> = [];
      for (const metaFile of metas.slice(0, 100)) {
        try {
          const parsed = JSON.parse(await readFile(join(dir, metaFile), 'utf8')) as Record<string, unknown>;
          entries.push({
            seq: parsed.seq,
            relPath: parsed.relPath,
            hadPrior: parsed.hadPrior,
            toolName: parsed.toolName,
            createdAtMs: parsed.createdAtMs,
          });
        } catch {
          entries.push({ metaFile, unreadable: true });
        }
      }
      summary.push({ sessionId: session, entryCount: metas.length, entries });
    }
    return { available: true, sessions: summary };
  } catch (error) {
    return { available: false, reason: String(error) };
  }
}

export async function buildSupportBundle(ctx: SupportBundleContext): Promise<{
  bundle: Record<string, unknown>;
  truncated: string[];
}> {
  const truncated: string[] = [];
  const settings = await getAllSettings();
  const workspace = await getActiveWorkspaceProfile().catch(() => null);
  const accounts = await listProviderAccounts().catch(() => []);
  const keyInfo = await getProviderService().listAccountsKeyInfo().catch(() => []);
  const hasKeyByAccount = new Map(keyInfo.map((info) => [info.accountId, info.hasKey]));

  const providers = accounts.map((account) => ({
    // Provider TYPE + verification state only. Never key material (hard lock).
    vendorId: account.vendorId,
    authMode: account.authMode,
    enabled: account.enabled,
    hasKey: hasKeyByAccount.get(account.id) === true,
    validation: account.metadata?.validation ?? { status: 'unchecked' },
  }));

  const gatewayStatus = ctx.gatewayManager.getStatus();
  const runtimeMirror = await collectRuntimeMirror(ctx.gatewayManager);
  const preview = await getDcsPreviewState().catch(() => null);
  const journal = await collectJournalSummary(workspace?.rootPath);

  const verseLogTail = truncateTail(await logger.readLogFile(MAX_LOG_TAIL_LINES).catch(() => ''), MAX_LOG_TAIL_LINES);
  if (verseLogTail.length > 0) truncated.push(`verseClawLogTail:${MAX_LOG_TAIL_LINES}-lines`);

  const bundle: Record<string, unknown> = {
    schema: 'verse-claw-support-bundle/1',
    generatedAt: new Date().toISOString(),
    app: {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
    },
    settings: {
      // Saved control-plane values (compare against runtimeMirror.effectiveFlags).
      dcsFlags: {
        dcsContextViewToolsEnabled: settings.dcsContextViewToolsEnabled,
        dcsWorkingMemoryEnabled: settings.dcsWorkingMemoryEnabled,
        dcsToolRegistryEnabled: settings.dcsToolRegistryEnabled,
        dcsStaleWriteGuardEnabled: settings.dcsStaleWriteGuardEnabled,
        dcsSymbolLeaseEnabled: settings.dcsSymbolLeaseEnabled,
        dcsRoutingMemoShadowEnabled: settings.dcsRoutingMemoShadowEnabled,
        dcsSekbExperienceShadowEnabled: settings.dcsSekbExperienceShadowEnabled,
      },
      dcsFlagAckTuning: {
        timeoutMs: settings.dcsFlagAckTimeoutMs,
        pollInitialMs: settings.dcsFlagAckPollInitialMs,
      },
      setupProviderVerification: settings.setupProviderVerification,
      gatewayAutoStart: settings.gatewayAutoStart,
      gatewayPort: settings.gatewayPort,
    },
    gateway: {
      state: gatewayStatus.state,
      port: gatewayStatus.port,
      gatewayReady: (gatewayStatus as { gatewayReady?: boolean }).gatewayReady,
    },
    providers,
    dcsPreview: preview,
    runtimeMirror,
    workspace: workspace
      ? {
          id: workspace.id,
          rootPath: workspace.rootPath,
          permissionMode: workspace.permissionMode,
          agentId: workspace.agentId,
          activeSessionKey: workspace.activeSessionKey,
        }
      : null,
    journal,
    verseClawLogTail: verseLogTail,
  };
  return { bundle, truncated };
}

export async function exportSupportBundle(ctx: SupportBundleContext): Promise<SupportBundleResult> {
  try {
    const { bundle, truncated } = await buildSupportBundle(ctx);
    let serialized = JSON.stringify(bundle, null, 2);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BUNDLE_BYTES) {
      // Drop the log tail first — it is the only unbounded-ish section.
      bundle.verseClawLogTail = '[truncated: bundle size cap]';
      truncated.push('verseClawLogTail:size-cap');
      serialized = JSON.stringify(bundle, null, 2);
    }
    const { sanitized, findings } = redactSupportBundleText(serialized);
    const stillMatching = verifyRedaction(sanitized);
    if (stillMatching.length > 0) {
      // Hard lock: redaction failure ⇒ export failure.
      return {
        success: false,
        error: `redaction verification failed for: ${stillMatching.join(', ')}`,
      };
    }
    const totalHits = findings.reduce((sum, finding) => sum + finding.hits, 0);
    // The redaction report itself is part of the bundle (AC).
    const finalBundle = {
      ...(JSON.parse(sanitized) as Record<string, unknown>),
      redactionReport: {
        scannedPatterns: findings.map((finding) => finding.type),
        findings: findings.filter((finding) => finding.hits > 0),
        totalHits,
        verified: true,
      },
      truncated,
    };
    const dir = join(app.getPath('userData'), 'support-bundles');
    await mkdir(dir, { recursive: true });
    const fileName = `verse-claw-support-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const outPath = join(dir, fileName);
    await writeFile(outPath, `${JSON.stringify(finalBundle, null, 2)}\n`, 'utf8');
    return {
      success: true,
      path: outPath,
      redaction: {
        findings: findings.filter((finding) => finding.hits > 0),
        totalHits,
        verified: true,
      },
      truncated,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
