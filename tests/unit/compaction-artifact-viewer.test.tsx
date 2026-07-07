import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompactionArtifactViewer } from '@/pages/Chat/CompactionArtifactViewer';
import type { CompressionArtifact } from '@/lib/host-api';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'composer.compaction.artifactViewer.title': 'Compression Evidence',
        'composer.compaction.artifactViewer.description': 'Review the bounded compression artifact before continuing.',
        'composer.compaction.artifactViewer.summary': 'Summary',
        'composer.compaction.artifactViewer.objective': 'Objective',
        'composer.compaction.artifactViewer.currentState': 'Current state',
        'composer.compaction.artifactViewer.identifiers': 'Identifiers',
        'composer.compaction.artifactViewer.quality': 'Quality',
        'composer.compaction.artifactViewer.warnings': 'Warnings',
        'composer.compaction.artifactViewer.unverifiedClaims': 'Unverified claims',
        'composer.compaction.artifactViewer.reviewNeeded': 'Review needed',
        'composer.compaction.artifactViewer.empty': 'No compression evidence is available yet.',
        'composer.compaction.artifactViewer.noWarnings': 'No warnings reported.',
        'composer.compaction.artifactViewer.noUnverifiedClaims': 'No unverified claims reported.',
        'composer.compaction.artifactViewer.noReviewNeeded': 'No review items reported.',
        'composer.compaction.artifactViewer.viewEvidence': 'View compression evidence',
        'composer.compaction.artifactViewer.prepareRecovery': 'Prepare recovery context',
        'composer.compaction.artifactViewer.forkSession': 'Fork/branch session',
        'composer.compaction.artifactViewer.close': 'Close',
        'composer.compaction.artifactViewer.qualityScore': `Score ${values?.score}%`,
        'composer.compaction.artifactViewer.qualityCoverage': `Evidence ${values?.evidence}% · fields ${values?.fields}% · recovery ${values?.tokens} tokens`,
        'composer.compaction.artifactViewer.checkpointId': `Checkpoint ${values?.checkpointId}`,
        'composer.compaction.artifactViewer.sessionKey': `Session ${values?.sessionKey}`,
      };
      return labels[key] ?? key;
    },
  }),
}));

function artifactFixture(overrides: Partial<CompressionArtifact> = {}): CompressionArtifact {
  return {
    schemaVersion: 1,
    objective: 'Ship evidence-backed session continuation.',
    constraints: [],
    currentState: 'Renderer can request compaction artifacts through host-api.',
    done: [
      { text: 'Host facade exposes compressionArtifact.', evidenceRefs: [{ type: 'file', ref: 'src/lib/host-api.ts' }] },
    ],
    inProgress: [],
    blocked: [],
    decisions: [],
    filesTouched: [
      { text: 'src/pages/Chat/CompactionArtifactViewer.tsx', evidenceRefs: [{ type: 'file', ref: 'src/pages/Chat/CompactionArtifactViewer.tsx' }] },
    ],
    testsRun: [],
    failedAttempts: [],
    deviations: [],
    nextAction: 'Prepare a reviewable handoff.',
    reviewNeeded: [
      { text: 'Confirm recovery wording remains manual and bounded.', evidenceRefs: [{ type: 'manual', ref: 'P2-04' }] },
    ],
    evidenceRefs: [
      { type: 'file', ref: 'src/lib/host-api.ts', label: 'host-api facade' },
    ],
    unverifiedClaims: ['Runtime refresh has not consumed this artifact yet.'],
    quality: {
      level: 'medium',
      score: 0.72,
      fieldCoverage: 0.86,
      evidenceCoverage: 0.64,
      artifactTokens: 320,
      projectionTokens: 180,
      warnings: ['One recovery fact needs review.'],
    },
    warnings: ['Artifact excludes stale transcript details.'],
    ...overrides,
  };
}

describe('CompactionArtifactViewer', () => {
  it('renders artifact evidence, quality, warnings, unverified claims, and review items', () => {
    render(
      <CompactionArtifactViewer
        open
        onOpenChange={vi.fn()}
        sessionKey="agent:main:main"
        checkpointId="ltcp-1"
        artifact={artifactFixture()}
        onPrepareRecovery={vi.fn()}
        onForkSession={vi.fn()}
      />,
    );

    expect(screen.getByTestId('chat-compaction-artifact-viewer')).toBeInTheDocument();
    expect(screen.getByText('Ship evidence-backed session continuation.')).toBeInTheDocument();
    expect(screen.getByText('Renderer can request compaction artifacts through host-api.')).toBeInTheDocument();
    expect(screen.getByText('Checkpoint ltcp-1')).toBeInTheDocument();
    expect(screen.getByText('Session agent:main:main')).toBeInTheDocument();
    expect(screen.getByText('Score 72%')).toBeInTheDocument();
    expect(screen.getByText('Evidence 64% · fields 86% · recovery 180 tokens')).toBeInTheDocument();
    expect(screen.getByText('Artifact excludes stale transcript details.')).toBeInTheDocument();
    expect(screen.getByText('One recovery fact needs review.')).toBeInTheDocument();
    expect(screen.getByText('Runtime refresh has not consumed this artifact yet.')).toBeInTheDocument();
    expect(screen.getByText('Confirm recovery wording remains manual and bounded.')).toBeInTheDocument();
    expect(screen.queryByText(/lossless|无损/i)).not.toBeInTheDocument();
  });

  it('shows bounded empty states when the artifact is missing', () => {
    render(
      <CompactionArtifactViewer
        open
        onOpenChange={vi.fn()}
        sessionKey="agent:main:main"
        artifact={null}
        onPrepareRecovery={vi.fn()}
        onForkSession={vi.fn()}
      />,
    );

    expect(screen.getAllByText('No compression evidence is available yet.').length).toBeGreaterThan(0);
    expect(screen.getByText('No warnings reported.')).toBeInTheDocument();
    expect(screen.getByText('No unverified claims reported.')).toBeInTheDocument();
    expect(screen.getByText('No review items reported.')).toBeInTheDocument();
  });

  it('routes recovery and fork actions to existing callbacks', () => {
    const onPrepareRecovery = vi.fn();
    const onForkSession = vi.fn();

    render(
      <CompactionArtifactViewer
        open
        onOpenChange={vi.fn()}
        sessionKey="agent:main:main"
        artifact={artifactFixture()}
        onPrepareRecovery={onPrepareRecovery}
        onForkSession={onForkSession}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Prepare recovery context' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fork/branch session' }));

    expect(onPrepareRecovery).toHaveBeenCalledTimes(1);
    expect(onForkSession).toHaveBeenCalledTimes(1);
  });

  it('keeps evidence references visible near their facts', () => {
    render(
      <CompactionArtifactViewer
        open
        onOpenChange={vi.fn()}
        sessionKey="agent:main:main"
        artifact={artifactFixture()}
        onPrepareRecovery={vi.fn()}
        onForkSession={vi.fn()}
      />,
    );

    const summary = screen.getByTestId('chat-compaction-artifact-summary');
    expect(within(summary).getByText('src/lib/host-api.ts')).toBeInTheDocument();
  });
});
