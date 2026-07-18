import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_CATEGORIES = new Set(['model', 'oauth', 'mcp', 'update', 'sensitive-capture', 'telemetry']);
const REQUIRED_FLOW_FIELDS = ['id', 'category', 'source', 'destination', 'dataClasses', 'minimization', 'userControl', 'retention', 'evidenceRefs'];

export function validatePrivacyDataFlowInventory({ root, inventory }) {
  const errors = [];
  if (inventory.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Array.isArray(inventory.flows) || inventory.flows.length === 0) errors.push('flows must be non-empty');
  const ids = new Set();
  const categories = new Set();
  for (const flow of inventory.flows || []) {
    if (!flow.id) errors.push('flow missing id');
    else if (ids.has(flow.id)) errors.push(`duplicate flow ${flow.id}`);
    else ids.add(flow.id);
    for (const field of REQUIRED_FLOW_FIELDS) {
      if (flow[field] == null || flow[field] === '') errors.push(`flow ${flow.id || '(unknown)'} missing ${field}`);
    }
    if (Array.isArray(flow.dataClasses) && flow.dataClasses.length === 0) errors.push(`flow ${flow.id} dataClasses empty`);
    if (Array.isArray(flow.evidenceRefs)) {
      for (const ref of flow.evidenceRefs) {
        const abs = path.join(root, ref);
        if (!fs.existsSync(abs)) errors.push(`flow ${flow.id} missing evidence path ${ref}`);
      }
    }
    if (flow.category) categories.add(flow.category);
  }
  for (const category of REQUIRED_CATEGORIES) {
    if (!categories.has(category)) errors.push(`missing required category ${category}`);
  }
  return errors;
}

export function validateSensitiveCapturePolicySemantics(decideSensitiveCapture) {
  const errors = [];
  const now = Date.parse('2026-07-18T12:00:00.000Z');
  const base = {
    killSwitch: false,
    retentionMaxHours: 72,
    channels: {
      clipboard: { enabled: true, requireGrant: false },
      screenshot: { enabled: true, requireGrant: true },
      desktopAutomation: { enabled: true, requireGrant: true },
    },
    grants: [{
      id: 'g1',
      channel: 'screenshot',
      grantedAt: '2026-07-18T11:00:00.000Z',
      expiresAt: '2026-07-18T13:00:00.000Z',
    }],
  };

  const kill = decideSensitiveCapture({ policy: { ...base, killSwitch: true }, channel: 'clipboard', nowMs: now });
  if (kill.allowed || kill.code !== 'kill-switch') errors.push('kill switch must deny');

  const missingGrant = decideSensitiveCapture({ policy: base, channel: 'screenshot', nowMs: now });
  if (missingGrant.allowed || missingGrant.code !== 'grant-required') errors.push('missing grant must deny screenshot');

  const allow = decideSensitiveCapture({ policy: base, channel: 'screenshot', grantId: 'g1', nowMs: now });
  if (!allow.allowed) errors.push('valid grant must allow screenshot');

  const expired = decideSensitiveCapture({
    policy: {
      ...base,
      grants: [{ ...base.grants[0], expiresAt: '2026-07-18T11:30:00.000Z' }],
    },
    channel: 'screenshot',
    grantId: 'g1',
    nowMs: now,
  });
  if (expired.allowed || expired.code !== 'grant-expired') errors.push('expired grant must deny');

  return errors;
}
