/** Host-owned filesystem evidence used to verify live VerseShell receipts. */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { Observation } from '../../shared/verseshell/types.ts';
import { executionInputDigest } from './versegit-receipt-bridge.ts';
import type {
  ReceiptAuthorityCheck,
  VerificationPlan,
  VerseShellReceipt,
  VerseShellReceiptAuthority,
} from './versegit-receipt-bridge.ts';

export const VG_HOST_EVIDENCE_SCHEMA = 'clawx.versegit.host-evidence/v1' as const;
export const VG_HOST_OBSERVATION_SCHEMA = 'clawx.versegit.host-observation/v1' as const;
export const VG_HOST_EVIDENCE_MANIFEST_SCHEMA = 'clawx.versegit.host-evidence-manifest/v1' as const;

type EvidenceRef = { path: string; digest: string };

export type HostObservationCommandBinding = {
  planId: string;
  planDigest: string;
  candidateId: string;
  checkId: string;
  argvDigest: string;
  cwdDigest: string;
  envDigest: string;
  executionInputDigest: string;
};

export type HostObservationEvidenceInput = {
  observation: Observation;
  stdout: string;
  stderr: string;
  processKeyDigest: string;
  processPid: number | null;
  managerKeyDigest: string;
  capturedAt?: string;
  binding?: HostObservationCommandBinding;
};

export type HostCommandEvidenceInput = {
  route: 'host-owned-sidecar-fixed-argv';
  argvShape: string[];
  cwdRole: string;
  stdout: string;
  stderr: string;
  processPid: number | null;
  exitCode: number | null;
  timedOut: boolean;
  capturedAt?: string;
};

export type HostCommandEvidence = EvidenceRef & {
  schema: 'clawx.versegit.host-command-evidence/v1';
  route: 'host-owned-sidecar-fixed-argv';
  argvShape: string[];
  cwdRole: string;
  stdoutDigest: string;
  stderrDigest: string;
  processPid: number | null;
  exitCode: number | null;
  timedOut: boolean;
  exited: true;
  capturedAt: string;
};

export type HostObservationEvidence = EvidenceRef & {
  schema: typeof VG_HOST_OBSERVATION_SCHEMA;
  observationId: string;
  observation: Observation;
  binding?: HostObservationCommandBinding;
  observationDigest: string;
  stdoutDigest: string;
  stderrDigest: string;
  artifactDigests: string[];
  process: {
    processKeyDigest: string;
    pid: number | null;
    managerKeyDigest: string;
    capturedAt: string;
  };
};

export type HostEvidenceManifest = EvidenceRef & {
  schema: typeof VG_HOST_EVIDENCE_MANIFEST_SCHEMA;
  files: Array<{ path: string; digest: string; bytes: number }>;
  aggregateDigest: string;
};

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return 'null';
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll('\\', '/');
}

function idFile(id: string): string {
  return `${sha256(id)}.json`;
}

function walkFiles(root: string, current = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(root, absolute));
    else if (entry.isFile()) files.push(normalizeRelativePath(relative(root, absolute)));
  }
  return files;
}

function assertInside(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(candidate);
  const rel = relative(resolvedRoot, resolved);
  if (rel.startsWith('..') || rel === '..' || resolve(rel) === rel) throw new Error('host evidence path escaped its root');
  return resolved;
}

export class FileVerseShellReceiptAuthority implements VerseShellReceiptAuthority {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  reset(): void {
    rmSync(this.root, { recursive: true, force: true });
    mkdirSync(this.root, { recursive: true });
  }

  private absolute(path: string): string {
    return assertInside(this.root, join(this.root, path));
  }

  private ref(path: string): EvidenceRef {
    return { path: normalizeRelativePath(relative(this.root, path)), digest: sha256(readFileSync(path)) };
  }

  private writeBytes(path: string, bytes: string | Uint8Array): EvidenceRef {
    const absolute = this.absolute(path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes);
    return this.ref(absolute);
  }

  private writeCanonical(path: string, value: unknown): EvidenceRef {
    return this.writeBytes(path, `${stableJson(value)}\n`);
  }

  private writeArtifactBytes(bytes: string | Uint8Array): string {
    const digest = sha256(bytes);
    const path = join('artifacts', digest);
    const absolute = this.absolute(path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes);
    return digest;
  }

  private readJson<T>(path: string): T {
    return JSON.parse(readFileSync(this.absolute(path), 'utf8')) as T;
  }

  recordPlan(plan: VerificationPlan): EvidenceRef {
    const bytes = `${stableJson(plan)}\n`;
    this.writeArtifactBytes(bytes);
    return this.writeBytes(join('plans', idFile(plan.runId)), bytes);
  }

  recordCandidateInput(candidateId: string, manifest: unknown): EvidenceRef {
    const bytes = `${stableJson({ candidateId, manifest })}\n`;
    this.writeArtifactBytes(bytes);
    return this.writeBytes(join('inputs', idFile(candidateId)), bytes);
  }

  recordObservation(input: HostObservationEvidenceInput): HostObservationEvidence {
    const observationBytes = stableJson(input.observation);
    const observationDigest = this.writeArtifactBytes(observationBytes);
    const stdoutDigest = this.writeArtifactBytes(input.stdout);
    const stderrDigest = this.writeArtifactBytes(input.stderr);
    const wrapper = {
      schema: VG_HOST_OBSERVATION_SCHEMA,
      observationId: input.observation.id,
      observation: input.observation,
      ...(input.binding ? { binding: input.binding } : {}),
      observationDigest,
      stdoutDigest,
      stderrDigest,
      artifactDigests: [...new Set([observationDigest, stdoutDigest, stderrDigest])].sort(),
      process: {
        processKeyDigest: input.processKeyDigest,
        pid: input.processPid,
        managerKeyDigest: input.managerKeyDigest,
        capturedAt: input.capturedAt ?? new Date().toISOString(),
      },
    };
    const stored = this.writeCanonical(join('observations', idFile(input.observation.id)), wrapper);
    return {
      ...stored,
      schema: VG_HOST_OBSERVATION_SCHEMA,
      observationId: input.observation.id,
      observation: input.observation,
      ...(input.binding ? { binding: input.binding } : {}),
      observationDigest,
      stdoutDigest,
      stderrDigest,
      artifactDigests: wrapper.artifactDigests,
      process: wrapper.process,
    } as HostObservationEvidence;
  }

  recordCommandEvidence(name: string, input: HostCommandEvidenceInput): HostCommandEvidence {
    const stdoutDigest = this.writeArtifactBytes(input.stdout);
    const stderrDigest = this.writeArtifactBytes(input.stderr);
    const capturedAt = input.capturedAt ?? new Date().toISOString();
    const wrapper = {
      schema: 'clawx.versegit.host-command-evidence/v1' as const,
      route: input.route,
      argvShape: input.argvShape,
      cwdRole: input.cwdRole,
      stdoutDigest,
      stderrDigest,
      processPid: input.processPid,
      exitCode: input.exitCode,
      timedOut: input.timedOut,
      exited: true as const,
      capturedAt,
    };
    const stored = this.writeCanonical(join('commands', idFile(name)), wrapper);
    return { ...stored, ...wrapper } as HostCommandEvidence;
  }

  recordReceipt(receipt: VerseShellReceipt): EvidenceRef {
    return this.writeCanonical(join('receipts', idFile(receipt.receiptId)), receipt);
  }

  recordJsonDocument(name: string, value: unknown): EvidenceRef {
    return this.writeCanonical(join('documents', idFile(name)), value);
  }

  recordCleanup(cleanup: unknown): EvidenceRef {
    return this.writeCanonical('cleanup.json', cleanup);
  }

  fileDigest(path: string): string {
    return sha256(readFileSync(this.absolute(path)));
  }

  manifest(): HostEvidenceManifest {
    const files = walkFiles(this.root).map((path) => {
      const absolute = this.absolute(path);
      return { path, digest: sha256(readFileSync(absolute)), bytes: statSync(absolute).size };
    });
    const aggregateDigest = sha256(stableJson(files));
    const stored = this.writeCanonical('manifest.json', {
      schema: VG_HOST_EVIDENCE_MANIFEST_SCHEMA,
      files,
      aggregateDigest,
    });
    return {
      ...stored,
      schema: VG_HOST_EVIDENCE_MANIFEST_SCHEMA,
      files,
      aggregateDigest,
    };
  }

  verifyReceipt({ plan, receipt }: { plan: VerificationPlan; receipt: VerseShellReceipt }): ReceiptAuthorityCheck {
    const issues: string[] = [];
    const add = (condition: boolean, message: string) => { if (!condition) issues.push(message); };
    const requireFileDigest = (path: string, digest: string | undefined, label: string) => {
      const absolute = this.absolute(path);
      add(existsSync(absolute), `${label} evidence is missing`);
      if (existsSync(absolute)) add(sha256(readFileSync(absolute)) === digest, `${label} evidence digest mismatch`);
    };

    const receiptPath = join('receipts', idFile(receipt.receiptId));
    add(existsSync(this.absolute(receiptPath)), 'host receipt record is missing');
    if (existsSync(this.absolute(receiptPath))) {
      const storedReceipt = this.readJson<VerseShellReceipt>(receiptPath);
      add(stableJson(storedReceipt) === stableJson(receipt), 'receipt differs from the host-recorded receipt');
    }

    const planPath = join('plans', idFile(plan.runId));
    requireFileDigest(planPath, receipt.planFileDigest, 'plan');
    if (existsSync(this.absolute(planPath))) {
      const storedPlan = this.readJson<VerificationPlan>(planPath);
      add(stableJson(storedPlan) === stableJson(plan), 'plan differs from the host-recorded plan');
    }

    const inputPath = join('inputs', idFile(plan.candidateId));
    requireFileDigest(inputPath, receipt.inputManifestDigest, 'candidate input manifest');
    if (existsSync(this.absolute(inputPath))) {
      const storedInput = this.readJson<Record<string, unknown>>(inputPath);
      add(storedInput.candidateId === plan.candidateId, 'candidate input identity mismatch');
    }

    const observationPath = join('observations', idFile(String(receipt.observationId ?? '')));
    add(existsSync(this.absolute(observationPath)), 'host observation record is missing');
    if (existsSync(this.absolute(observationPath))) {
      const stored = this.readJson<HostObservationEvidence>(observationPath);
      add(stored.observationId === receipt.observationId, 'observation identity mismatch');
      add(stored.observationDigest === receipt.observationDigest, 'observation digest mismatch');
      add(stored.stdoutDigest === receipt.stdoutDigest, 'stdout digest mismatch');
      add(stored.stderrDigest === receipt.stderrDigest, 'stderr digest mismatch');
      add(stored.process.processKeyDigest === receipt.processKey, 'process identity mismatch');
      add(Number.isInteger(stored.process.pid) && Number(stored.process.pid) > 0, 'OS process pid was not captured');
      const command = plan.commands[0];
      const expectedBinding = {
        planId: plan.runId,
        planDigest: String(plan.planDigest ?? ''),
        candidateId: plan.candidateId,
        checkId: plan.checkId,
        argvDigest: sha256(JSON.stringify(command?.argv ?? [])),
        cwdDigest: sha256(JSON.stringify(command?.cwd ?? '')),
        envDigest: sha256(JSON.stringify(command?.env ?? {})),
        executionInputDigest: executionInputDigest(plan),
      };
      add(Boolean(stored.binding), 'observation command binding is missing');
      for (const [key, expected] of Object.entries(expectedBinding)) {
        add(stored.binding?.[key as keyof typeof expectedBinding] === expected, `observation ${key} differs from plan`);
      }
      add(receipt.planId === stored.binding?.planId, 'receipt planId differs from observation binding');
      add(receipt.planDigest === stored.binding?.planDigest, 'receipt planDigest differs from observation binding');
      add(receipt.candidateId === stored.binding?.candidateId, 'receipt candidateId differs from observation binding');
      add(receipt.checkId === stored.binding?.checkId, 'receipt checkId differs from observation binding');
      add(receipt.argvDigest === stored.binding?.argvDigest, 'receipt argvDigest differs from observation binding');
      add(receipt.cwdDigest === stored.binding?.cwdDigest, 'receipt cwdDigest differs from observation binding');
      add(receipt.envDigest === stored.binding?.envDigest, 'receipt envDigest differs from observation binding');
      add(receipt.executionInputDigest === stored.binding?.executionInputDigest, 'receipt executionInputDigest differs from observation binding');
      const observationData = stored.observation.data && typeof stored.observation.data === 'object' && !Array.isArray(stored.observation.data)
        ? stored.observation.data as Record<string, unknown>
        : {};
      add(observationData.exit_code === receipt.exitCode, 'observation exit code differs from receipt');
      add((observationData.timed_out === true) === (receipt.status === 'timed-out'), 'observation timeout status differs from receipt');
      for (const digest of stored.artifactDigests) add(receipt.artifactDigests.includes(digest), `unexpected observation artifact ${digest}`);
    }

    const expected = [
      receipt.observationDigest,
      receipt.stdoutDigest,
      receipt.stderrDigest,
      receipt.planFileDigest,
      receipt.inputManifestDigest,
    ].filter((value): value is string => typeof value === 'string');
    for (const digest of expected) {
      add(receipt.artifactDigests.includes(digest), `required artifact is not bound: ${digest}`);
      const artifactPath = join('artifacts', digest);
      requireFileDigest(artifactPath, digest, `artifact ${digest}`);
    }
    for (const digest of receipt.artifactDigests) {
      const artifactPath = join('artifacts', digest);
      add(existsSync(this.absolute(artifactPath)), `receipt artifact is missing: ${digest}`);
      if (existsSync(this.absolute(artifactPath))) add(sha256(readFileSync(this.absolute(artifactPath))) === digest, `receipt artifact digest mismatch: ${digest}`);
    }

    const cleanupPath = 'cleanup.json';
    add(existsSync(this.absolute(cleanupPath)), 'cleanup evidence is missing');
    if (existsSync(this.absolute(cleanupPath))) {
      const cleanup = this.readJson<Record<string, unknown>>(cleanupPath);
      add(cleanup.status === receipt.cleanupStatus, 'cleanup status differs from receipt');
      add(!Array.isArray(cleanup.survivorPids) || cleanup.survivorPids.length === 0, 'cleanup retained process survivors');
    }

    return { ok: issues.length === 0, issues: [...new Set(issues)], observationDigest: receipt.observationDigest, artifactDigests: receipt.artifactDigests };
  }
}
