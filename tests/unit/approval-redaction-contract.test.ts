/**
 * Guards the redaction contract at its weakest point: the call sites.
 *
 * `stripSensitiveApprovalDetails` and `approvalDisplayDetails` were both correct
 * and both bypassed — three panels read `approval.reason` directly, and the
 * external-write reason is the one that embeds `workspace.rootPath` verbatim
 * (`workspace-permissions.ts` FP-P1-02). A unit test of the helpers cannot catch
 * that, so this file reads the renderer sources instead.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvalDisplayDetails,
  isExternalWriteApproval,
  isIrreversibleApproval,
  stripSensitiveApprovalDetails,
} from '@/lib/permission-approval-display';
import type { PermissionApprovalEvent } from '@shared/types/workspace';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function source(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/** Every renderer surface that reads an approval's request-derived fields. */
const APPROVAL_RENDERING_SOURCES = [
  'src/components/tool-ui/PendingRunApprovals.tsx',
  'src/components/file-preview/WorkspaceAuditPanel.tsx',
  'src/components/file-preview/WorkspaceGitPanel.tsx',
  'src/components/file-preview/WorkspaceTerminalPanel.tsx',
  'src/components/agents/RolesOrchestrationPanel.tsx',
  'src/stores/inbox.ts',
];

/**
 * The fields `stripSensitiveApprovalDetails` removes. `requestHash` belongs here
 * because it is built from the request itself — `${cwd}:${command}`,
 * `${path}:${bytes}`, `${method}:${stableJson(params)}` — so leaving it in place
 * re-admits exactly what the other deletes remove.
 */
const REQUEST_DERIVED_FIELDS = [
  'command',
  'cwd',
  'paths',
  'paramsPreview',
  'reason',
  'requestHash',
] as const;

function externalWriteApproval(): PermissionApprovalEvent {
  return {
    id: 'approval-1',
    workspaceId: 'workspace-1',
    sessionKey: 'session-1',
    mode: 'acceptEdits',
    source: 'file',
    requestedAt: 1,
    status: 'pending',
    risk: 'external-write',
    command: 'node build.js --token SECRET_VALUE',
    cwd: 'C:/private/project',
    paths: ['C:/private/project/output.txt'],
    paramsPreview: '{"token":"SECRET_VALUE"}',
    // The real FP-P1-02 denial text, which names the workspace root.
    reason: 'Write target is outside the workspace boundary (C:/private/project); external writes require approval',
    requestHash: 'C:/private/project/output.txt:4096',
  };
}

describe('external-write approval redaction contract', () => {
  it('removes every request-derived field, including the request digest', () => {
    const safe = stripSensitiveApprovalDetails(externalWriteApproval());
    for (const field of REQUEST_DERIVED_FIELDS) {
      expect(safe[field], field).toBeUndefined();
    }
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain('SECRET_VALUE');
    expect(serialized).not.toContain('C:/private/project');
    expect(serialized).not.toContain('build.js');
  });

  it('keeps the identity fields a surface needs to render and decide', () => {
    const safe = stripSensitiveApprovalDetails(externalWriteApproval());
    expect(safe).toMatchObject({
      id: 'approval-1',
      workspaceId: 'workspace-1',
      sessionKey: 'session-1',
      source: 'file',
      risk: 'external-write',
      status: 'pending',
    });
  });

  it('leaves a non-external-write approval untouched', () => {
    const approval: PermissionApprovalEvent = {
      ...externalWriteApproval(),
      risk: 'dangerous',
    };
    expect(stripSensitiveApprovalDetails(approval)).toBe(approval);
    expect(approvalDisplayDetails(approval).reason).toContain('outside the workspace boundary');
  });

  it('yields no renderable request content for an external write', () => {
    const display = approvalDisplayDetails(externalWriteApproval());
    expect(display).toEqual({});
  });
});

describe('external-write severity', () => {
  it('classifies the no-rollback class alongside the destructive ones', () => {
    // The surfaced severity must not read as milder than `dangerous`, which is
    // journal-covered and therefore recoverable.
    for (const risk of ['external-write', 'dangerous', 'destructive'] as const) {
      expect(isIrreversibleApproval({ risk }), risk).toBe(true);
    }
    for (const risk of ['write', 'network'] as const) {
      expect(isIrreversibleApproval({ risk }), risk).toBe(false);
    }
    expect(isExternalWriteApproval({ risk: 'dangerous' })).toBe(false);
  });
});

describe('approval rendering call sites', () => {
  it.each(APPROVAL_RENDERING_SOURCES)('%s never reads a raw request field', (relativePath) => {
    const text = source(relativePath);
    // `approval.command`-style reads are the bypass; the helpers exist precisely
    // so a surface never has to touch these directly.
    const rawReads = REQUEST_DERIVED_FIELDS.flatMap((field) => {
      const pattern = new RegExp(`(?:pendingApproval|approval|item\\.approval)\\.${field}\\b`, 'gu');
      return [...text.matchAll(pattern)].map((match) => match[0]);
    });
    // WorkspaceAuditPanel and inbox.ts read these behind an explicit
    // `externalWrite` / `display` guard, so allow a read that the same line
    // guards. Anything else must go through the helper.
    const unguarded = rawReads.filter((read) => {
      const line = text.split('\n').find((candidate) => candidate.includes(read)) ?? '';
      return !line.includes('externalWrite') && !line.includes('display.');
    });
    expect(unguarded, `${relativePath}: ${unguarded.join(', ')}`).toEqual([]);
  });

  it.each(APPROVAL_RENDERING_SOURCES)('%s imports the redaction helper', (relativePath) => {
    expect(source(relativePath)).toContain('permission-approval-display');
  });
});
