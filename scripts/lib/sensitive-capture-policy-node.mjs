export function normalizeSensitiveCapturePolicy(value, nowMs = Date.now()) {
  const input = value && typeof value === 'object' ? value : {};
  const channelsIn = input.channels && typeof input.channels === 'object' ? input.channels : {};
  const grantsIn = Array.isArray(input.grants) ? input.grants : [];
  const retention = Number(input.retentionMaxHours);
  return {
    killSwitch: Boolean(input.killSwitch),
    retentionMaxHours: Number.isFinite(retention) && retention > 0 ? Math.min(retention, 24 * 30) : 72,
    channels: {
      clipboard: { enabled: channelsIn.clipboard?.enabled !== false, requireGrant: Boolean(channelsIn.clipboard?.requireGrant) },
      screenshot: { enabled: channelsIn.screenshot?.enabled !== false, requireGrant: Boolean(channelsIn.screenshot?.requireGrant) },
      desktopAutomation: { enabled: channelsIn.desktopAutomation?.enabled !== false, requireGrant: channelsIn.desktopAutomation?.requireGrant !== false },
    },
    grants: grantsIn.filter((grant) => grant && typeof grant.id === 'string' && typeof grant.channel === 'string' && typeof grant.expiresAt === 'string')
      ,
  };
}

export function decideSensitiveCapture(options) {
  const nowMs = options.nowMs ?? Date.now();
  const policy = normalizeSensitiveCapturePolicy(options.policy, nowMs);
  const channel = options.channel;
  if (policy.killSwitch) return { allowed: false, code: 'kill-switch', reason: 'Sensitive capture kill switch is engaged', channel };
  const channelPolicy = policy.channels[channel];
  if (!channelPolicy?.enabled) return { allowed: false, code: 'channel-disabled', reason: `Sensitive capture channel is disabled: ${channel}`, channel };
  if (!channelPolicy.requireGrant) return { allowed: true, code: 'allow', reason: 'Channel enabled without grant requirement', channel };
  const grantId = typeof options.grantId === 'string' ? options.grantId.trim() : '';
  if (!grantId) return { allowed: false, code: 'grant-required', reason: `Explicit grant required for ${channel}`, channel };
  const grant = policy.grants.find((item) => item.id === grantId && item.channel === channel);
  if (!grant) return { allowed: false, code: 'grant-missing', reason: `No active grant ${grantId} for ${channel}`, channel };
  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return { allowed: false, code: 'grant-expired', reason: `Grant ${grantId} expired for ${channel}`, channel };
  return { allowed: true, code: 'allow', reason: `Grant ${grantId} authorizes ${channel}`, channel };
}

export function isRetentionExpired(options) {
  const capturedMs = Date.parse(options.capturedAt);
  if (!Number.isFinite(capturedMs)) return true;
  const maxMs = Math.max(1, options.retentionMaxHours) * 60 * 60 * 1000;
  return (options.nowMs ?? Date.now()) - capturedMs > maxMs;
}
