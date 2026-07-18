export type SensitiveCaptureChannel = 'clipboard' | 'screenshot' | 'desktopAutomation';

export type SensitiveCaptureGrant = {
  id: string;
  channel: SensitiveCaptureChannel;
  grantedAt: string;
  expiresAt: string;
  purpose?: string;
};

export type SensitiveCaptureChannelPolicy = {
  enabled: boolean;
  requireGrant: boolean;
};

export type SensitiveCapturePolicy = {
  killSwitch: boolean;
  retentionMaxHours: number;
  channels: Record<SensitiveCaptureChannel, SensitiveCaptureChannelPolicy>;
  grants: SensitiveCaptureGrant[];
};

export type SensitiveCaptureDecision = {
  allowed: boolean;
  code:
    | 'allow'
    | 'kill-switch'
    | 'channel-disabled'
    | 'grant-required'
    | 'grant-expired'
    | 'grant-missing'
    | 'invalid-policy';
  reason: string;
  channel: SensitiveCaptureChannel;
};

export const DEFAULT_SENSITIVE_CAPTURE_POLICY: SensitiveCapturePolicy = {
  killSwitch: false,
  retentionMaxHours: 72,
  channels: {
    clipboard: { enabled: true, requireGrant: false },
    screenshot: { enabled: true, requireGrant: false },
    desktopAutomation: { enabled: true, requireGrant: true },
  },
  grants: [],
};

type ChannelMap = Partial<Record<SensitiveCaptureChannel, Partial<SensitiveCaptureChannelPolicy>>>;

export function normalizeSensitiveCapturePolicy(
  value: unknown,
): SensitiveCapturePolicy {
  const input: Partial<SensitiveCapturePolicy> & { channels?: ChannelMap } =
    value && typeof value === 'object'
      ? value as Partial<SensitiveCapturePolicy> & { channels?: ChannelMap }
      : {};
  const channelsIn: ChannelMap =
    input.channels && typeof input.channels === 'object' ? input.channels : {};
  const grantsIn = Array.isArray(input.grants) ? input.grants : [];
  const retention = Number(input.retentionMaxHours);
  return {
    killSwitch: Boolean(input.killSwitch),
    retentionMaxHours: Number.isFinite(retention) && retention > 0 ? Math.min(retention, 24 * 30) : 72,
    channels: {
      clipboard: {
        enabled: channelsIn.clipboard?.enabled !== false,
        requireGrant: Boolean(channelsIn.clipboard?.requireGrant),
      },
      screenshot: {
        enabled: channelsIn.screenshot?.enabled !== false,
        requireGrant: Boolean(channelsIn.screenshot?.requireGrant),
      },
      desktopAutomation: {
        enabled: channelsIn.desktopAutomation?.enabled !== false,
        requireGrant: channelsIn.desktopAutomation?.requireGrant !== false,
      },
    },
    grants: grantsIn
      .filter((grant): grant is SensitiveCaptureGrant => Boolean(
        grant
        && typeof grant === 'object'
        && typeof (grant as SensitiveCaptureGrant).id === 'string'
        && typeof (grant as SensitiveCaptureGrant).channel === 'string'
        && typeof (grant as SensitiveCaptureGrant).grantedAt === 'string'
        && typeof (grant as SensitiveCaptureGrant).expiresAt === 'string',
      ))
      .map((grant) => ({
        id: grant.id,
        channel: grant.channel,
        grantedAt: grant.grantedAt,
        expiresAt: grant.expiresAt,
        purpose: typeof grant.purpose === 'string' ? grant.purpose : undefined,
      })),
  };
}

export function decideSensitiveCapture(options: {
  policy: unknown;
  channel: SensitiveCaptureChannel;
  grantId?: string | null;
  nowMs?: number;
}): SensitiveCaptureDecision {
  const nowMs = options.nowMs ?? Date.now();
  const policy = normalizeSensitiveCapturePolicy(options.policy);
  const channel = options.channel;

  if (policy.killSwitch) {
    return {
      allowed: false,
      code: 'kill-switch',
      reason: 'Sensitive capture kill switch is engaged',
      channel,
    };
  }

  const channelPolicy = policy.channels[channel];
  if (!channelPolicy?.enabled) {
    return {
      allowed: false,
      code: 'channel-disabled',
      reason: `Sensitive capture channel is disabled: ${channel}`,
      channel,
    };
  }

  if (!channelPolicy.requireGrant) {
    return {
      allowed: true,
      code: 'allow',
      reason: 'Channel enabled without grant requirement',
      channel,
    };
  }

  const grantId = typeof options.grantId === 'string' ? options.grantId.trim() : '';
  if (!grantId) {
    return {
      allowed: false,
      code: 'grant-required',
      reason: `Explicit grant required for ${channel}`,
      channel,
    };
  }

  const grant = policy.grants.find((item) => item.id === grantId && item.channel === channel);
  if (!grant) {
    return {
      allowed: false,
      code: 'grant-missing',
      reason: `No active grant ${grantId} for ${channel}`,
      channel,
    };
  }

  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    return {
      allowed: false,
      code: 'grant-expired',
      reason: `Grant ${grantId} expired for ${channel}`,
      channel,
    };
  }

  return {
    allowed: true,
    code: 'allow',
    reason: `Grant ${grantId} authorizes ${channel}`,
    channel,
  };
}

export function isRetentionExpired(options: {
  capturedAt: string;
  retentionMaxHours: number;
  nowMs?: number;
}): boolean {
  const capturedMs = Date.parse(options.capturedAt);
  if (!Number.isFinite(capturedMs)) return true;
  const maxMs = Math.max(1, options.retentionMaxHours) * 60 * 60 * 1000;
  return (options.nowMs ?? Date.now()) - capturedMs > maxMs;
}
