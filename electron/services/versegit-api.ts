import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { VerseGitDiagnosticBinding, VerseGitDiagnosticStatus } from '@shared/host-api/contract';
import { VerseGitFactAdapter, type VerseGitFactGrant, type VerseGitFactIdentity, type VerseGitFactResult, type VerseGitFactTrigger } from './versegit-fact-adapter';
import { VerseGitModule } from './versegit-module';

export const VG_HOST_DIAGNOSTIC_SCHEMA = 'clawx.versegit.host-diagnostics/v1';
export const VG_HOST_DECLARED_COVERAGE = ['version', 'capabilities'] as const;
export const VG_HOST_UNOBSERVED_COVERAGE = ['doctor', 'session', 'observe', 'conflicts', 'shell', 'direct-fs', 'network', 'mcp'] as const;

export type VerseGitHostDiagnosticConfig = {
  enabled: boolean;
  binaryPath: string | null;
  workspacePath: string | null;
  expectedBinarySha256: string | null;
  expectedVersion: string | null;
  expectedCapabilitiesDigest: string | null;
  contractDigest: string | null;
  allowed: (VerseGitDiagnosticBinding & {
    repoId: string;
    authorizationId: string;
    expiresAt: string;
    revoked: boolean;
  }) | null;
  worktreeCount: number;
  activeSessionCount: number;
};

type VerseGitHostDiagnosticConfigInput = Partial<Omit<VerseGitHostDiagnosticConfig, 'allowed'>> & {
  allowed?: Partial<NonNullable<VerseGitHostDiagnosticConfig['allowed']>> | null;
};

export function loadVerseGitHostDiagnosticConfig(env: NodeJS.ProcessEnv = process.env): VerseGitHostDiagnosticConfig {
  const enabled = env.CLAWX_VERSGIT_DIAGNOSTICS === '1';
  const allowed = {
    workspaceId: env.CLAWX_VERSGIT_ALLOWED_WORKSPACE_ID ?? '',
    sessionId: env.CLAWX_VERSGIT_ALLOWED_SESSION_ID ?? '',
    worktreeId: env.CLAWX_VERSGIT_ALLOWED_WORKTREE_ID ?? '',
    ownerId: env.CLAWX_VERSGIT_OWNER_ID ?? '',
    epoch: Number(env.CLAWX_VERSGIT_EPOCH ?? 0),
    mode: 'M1' as const,
    repoId: env.CLAWX_VERSGIT_REPO_ID ?? '',
    authorizationId: env.CLAWX_VERSGIT_AUTHORIZATION_ID ?? '',
    expiresAt: env.CLAWX_VERSGIT_GRANT_EXPIRES_AT ?? '',
    revoked: env.CLAWX_VERSGIT_GRANT_REVOKED === '1',
  };
  return {
    enabled,
    binaryPath: env.CLAWX_VERSGIT_BINARY ?? null,
    workspacePath: env.CLAWX_VERSGIT_PROVIDER_ROOT ?? null,
    expectedBinarySha256: env.CLAWX_VERSGIT_EXPECTED_BINARY_SHA256 ?? null,
    expectedVersion: env.CLAWX_VERSGIT_EXPECTED_VERSION ?? null,
    expectedCapabilitiesDigest: env.CLAWX_VERSGIT_EXPECTED_CAPABILITIES_SHA256 ?? null,
    contractDigest: env.CLAWX_VERSGIT_CONTRACT_DIGEST ?? null,
    allowed: enabled ? allowed : null,
    worktreeCount: Number(env.CLAWX_VERSGIT_WORKTREE_COUNT ?? 0),
    activeSessionCount: Number(env.CLAWX_VERSGIT_ACTIVE_SESSION_COUNT ?? 0),
  };
}

function normalizeConfig(input: VerseGitHostDiagnosticConfigInput | VerseGitHostDiagnosticConfig): VerseGitHostDiagnosticConfig {
  const allowed = input.allowed ? {
    workspaceId: String(input.allowed.workspaceId ?? ''),
    sessionId: String(input.allowed.sessionId ?? ''),
    worktreeId: String(input.allowed.worktreeId ?? ''),
    ownerId: String(input.allowed.ownerId ?? ''),
    epoch: Number(input.allowed.epoch ?? 0),
    mode: 'M1' as const,
    repoId: String(input.allowed.repoId ?? ''),
    authorizationId: String(input.allowed.authorizationId ?? ''),
    expiresAt: String(input.allowed.expiresAt ?? ''),
    revoked: input.allowed.revoked === true,
  } : null;
  return {
    enabled: input.enabled === true,
    binaryPath: input.binaryPath ?? null,
    workspacePath: input.workspacePath ?? null,
    expectedBinarySha256: input.expectedBinarySha256 ?? null,
    expectedVersion: input.expectedVersion ?? null,
    expectedCapabilitiesDigest: input.expectedCapabilitiesDigest ?? null,
    contractDigest: input.contractDigest ?? null,
    allowed,
    worktreeCount: Number(input.worktreeCount ?? 0),
    activeSessionCount: Number(input.activeSessionCount ?? 0),
  };
}

function safeCapabilities(document: unknown): VerseGitDiagnosticStatus['capabilities'] {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
  const value = document as Record<string, unknown>;
  const safety = value.safety && typeof value.safety === 'object' ? value.safety as Record<string, unknown> : {};
  const verdict = value.verdict && typeof value.verdict === 'object' ? value.verdict as Record<string, unknown> : {};
  const readSurface = verdict.read_surface && typeof verdict.read_surface === 'object' ? verdict.read_surface as Record<string, unknown> : null;
  const strings = (candidate: unknown) => Array.isArray(candidate) ? candidate.filter((entry: unknown): entry is string => typeof entry === 'string') : [];
  return {
    schema: typeof value.schema === 'string' ? value.schema : null,
    safety: { default_enable: safety.default_enable === false ? false : null, managed_opt_in: safety.managed_opt_in === true, strict_admission_present: safety.strict_admission_present === true },
    verdict: { single_green_light: verdict.single_green_light === false ? false : null, dimensions: strings(verdict.dimensions), read_surface: readSurface ? { observed_channels: strings(readSurface.observed_channels), unobserved_channels: strings(readSurface.unobserved_channels) } : null },
  };
}
function statusFromResults(version: VerseGitFactResult | null, capabilities: VerseGitFactResult | null): { status: VerseGitDiagnosticStatus['status']; reason?: string; issues: string[] } {
  const issues = [...(version?.issues ?? []), ...(capabilities?.issues ?? [])];
  if (version?.status === 'observed' && capabilities?.status === 'observed') return { status: 'observed', issues: [] };
  if (version?.status === 'rejected_by_policy' || capabilities?.status === 'rejected_by_policy') return { status: 'rejected_by_policy', reason: 'authority_rejected', issues };
  if (version?.status === 'partial' || capabilities?.status === 'partial') return { status: 'partial', reason: 'partial_coverage', issues };
  if (version?.status === 'degraded' || capabilities?.status === 'degraded') return { status: 'degraded', reason: version?.reason ?? capabilities?.reason ?? 'degraded', issues };
  return { status: 'unavailable', reason: version?.reason ?? capabilities?.reason ?? 'provider_unavailable', issues };
}

function bindingIssues(payload: unknown, allowed: NonNullable<VerseGitHostDiagnosticConfig['allowed']>): string[] {
  const value = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  if (!value) return ['binding payload is required'];
  const issues: string[] = [];
  for (const key of ['workspaceId', 'sessionId', 'worktreeId', 'ownerId'] as const) if (typeof value[key] !== 'string' || value[key].length === 0) issues.push(`${key} is required`);
  if (value.workspaceId !== allowed.workspaceId) issues.push('workspace binding is not authorized');
  if (value.sessionId !== allowed.sessionId) issues.push('session binding is not authorized');
  if (value.worktreeId !== allowed.worktreeId) issues.push('worktree binding is not authorized');
  if (value.ownerId !== allowed.ownerId) issues.push('owner binding is not authorized');
  if (value.epoch !== allowed.epoch) issues.push('epoch binding is not authorized');
  if (value.mode !== 'M1') issues.push('diagnostic mode must remain M1');
  return issues;
}

export type VerseGitApiOptions = {
  config?: VerseGitHostDiagnosticConfigInput;
  configLoader?: () => VerseGitHostDiagnosticConfig;
  adapterFactory?: (config: VerseGitHostDiagnosticConfig) => VerseGitFactAdapter;
};

export function createVerseGitApi(options: VerseGitApiOptions = {}): CompleteHostServiceRegistry['versegit'] {
  const getConfig = () => options.configLoader ? options.configLoader() : normalizeConfig(options.config ?? loadVerseGitHostDiagnosticConfig());
  const adapterFor = (config: VerseGitHostDiagnosticConfig) => {
    if (options.adapterFactory) return options.adapterFactory(config);
    if (!config.binaryPath || !config.workspacePath || !config.expectedBinarySha256 || !config.expectedVersion || !config.expectedCapabilitiesDigest || !config.contractDigest) {
      throw new Error('VerseGit diagnostic identity configuration is incomplete');
    }
    return new VerseGitFactAdapter({
      binaryPath: config.binaryPath,
      workspacePath: config.workspacePath,
      expectedBinarySha256: config.expectedBinarySha256,
      expectedVersion: config.expectedVersion,
      expectedCapabilitiesDigest: config.expectedCapabilitiesDigest,
      contractDigest: config.contractDigest,
    });
  };

  return {
    status: async (payload: VerseGitDiagnosticBinding): Promise<VerseGitDiagnosticStatus> => {
      const generatedAt = new Date().toISOString();
      const config = getConfig();
      const base: VerseGitDiagnosticStatus = {
        schema: 'clawx.versegit.host-diagnostics/v1',
        generatedAt,
        enabled: config.enabled,
        mode: config.allowed?.mode ?? 'M0',
        status: 'not_applicable',
        identity: {
          repoId: config.allowed?.repoId ?? null,
          binarySha256: config.expectedBinarySha256 ?? null,
          version: config.expectedVersion ?? null,
          capabilitiesSchema: null,
        },
        coverage: { declared: [...VG_HOST_DECLARED_COVERAGE], unobserved: [...VG_HOST_UNOBSERVED_COVERAGE] },
        capabilities: null,
        observation: null,
        issues: [],
        hostVerdict: 'unchanged',
      };
      if (!config.enabled) return { ...base, status: 'not_applicable', reason: 'disabled', issues: ['VerseGit diagnostics are disabled by host configuration'] };
      if (!config.allowed) return { ...base, status: 'rejected_by_policy', reason: 'identity_configuration_missing', issues: ['allowed host/provider identity is missing'] };
      const binding = bindingIssues(payload, config.allowed);
      if (binding.length > 0) return { ...base, status: 'rejected_by_policy', reason: 'identity_mismatch', issues: binding };
      const issues: string[] = [];
      if (!config.binaryPath || !config.workspacePath) issues.push('binary or provider workspace path is not configured');
      if (!config.expectedBinarySha256 || !config.expectedCapabilitiesDigest || !config.contractDigest) issues.push('frozen digest configuration is incomplete');
      if (issues.length > 0) return { ...base, status: 'unavailable', reason: 'configuration_incomplete', issues };
      let adapter: VerseGitFactAdapter;
      try { adapter = adapterFor(config); } catch (error) { return { ...base, status: 'unavailable', reason: 'binary_unavailable', issues: [String((error as Error)?.message ?? error).slice(0, 300)] }; }
      const identity: VerseGitFactIdentity = {
        repoId: config.allowed.repoId,
        worktreeId: config.allowed.worktreeId,
        ownerId: config.allowed.ownerId,
        epoch: config.allowed.epoch,
        sessionId: config.allowed.sessionId,
        vgSessionId: config.allowed.sessionId,
      };
      const grant: VerseGitFactGrant = {
        mode: 'M1', authorizationId: config.allowed.authorizationId,
        ownerId: config.allowed.ownerId, epoch: config.allowed.epoch,
        repoId: config.allowed.repoId, worktreeId: config.allowed.worktreeId,
        capabilityDigest: config.expectedCapabilitiesDigest!,
        expiresAt: config.allowed.expiresAt, revoked: config.allowed.revoked,
      };
      const trigger: VerseGitFactTrigger = {
        reason: 'host-diagnostics', enabled: true,
        worktreeCount: config.worktreeCount, activeSessionCount: config.activeSessionCount,
      };
      const module = new VerseGitModule({
        binaryPath: config.binaryPath!, 
        contractDigest: config.contractDigest!, 
        expectedCapabilitiesDigest: config.expectedCapabilitiesDigest!, 
        factAdapter: adapter,
      });
      const attached = module.attach('M1', { mode: 'M1', authorizationId: config.allowed.authorizationId });
      if (!attached.ok) return { ...base, status: 'rejected_by_policy', reason: 'module_attach_rejected', issues: attached.issues };
      const version = await module.readFact('version', identity, grant, trigger);
      const capabilities = await module.readFact('capabilities', identity, grant, trigger);
      const result = statusFromResults(version, capabilities);
      const capabilityDocument = capabilities.document as Record<string, unknown> | undefined;
      const processStarted = capabilities.observation.process_started || version.observation.process_started;
      return {
        ...base,
        ...result,
        identity: {
          repoId: config.allowed.repoId,
          binarySha256: version.observation.binary.sha256,
          version: typeof version.value === 'string' ? version.value : config.expectedVersion,
          capabilitiesSchema: typeof capabilityDocument?.schema === 'string' ? capabilityDocument.schema : null,
        },
        capabilities: safeCapabilities(capabilityDocument),
        observation: {
          processStarted,
          exitCode: capabilities.observation.exit_code ?? version.observation.exit_code,
          deadlineMs: capabilities.observation.deadline_ms,
          timedOut: capabilities.observation.timed_out || version.observation.timed_out,
          cancelled: capabilities.observation.cancelled || version.observation.cancelled,
          stdoutSha256: capabilities.observation.stdout.sha256,
          stderrSha256: capabilities.observation.stderr.sha256,
        },
      };
    },
  };
}
