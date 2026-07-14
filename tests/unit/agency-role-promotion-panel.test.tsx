import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgencyRolePromotionPanel } from '@/components/agents/AgencyRolePromotionPanel';
import type {
  AgencyRoleDraftSummary,
  AgencyRolePromotionRecord,
} from '@shared/host-api/contract';

const {
  agencyCatalogMock,
  approveAgencyPromotionMock,
  dialogOpenMock,
  previewAgencyPromotionMock,
  retireAgencyPromotionMock,
  reviewAgencyPromotionMock,
} = vi.hoisted(() => ({
  agencyCatalogMock: vi.fn(),
  approveAgencyPromotionMock: vi.fn(),
  dialogOpenMock: vi.fn(),
  previewAgencyPromotionMock: vi.fn(),
  retireAgencyPromotionMock: vi.fn(),
  reviewAgencyPromotionMock: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    dialog: {
      open: (...args: unknown[]) => dialogOpenMock(...args),
    },
    roles: {
      agencyCatalog: (...args: unknown[]) => agencyCatalogMock(...args),
      previewAgencyPromotion: (...args: unknown[]) => previewAgencyPromotionMock(...args),
      reviewAgencyPromotion: (...args: unknown[]) => reviewAgencyPromotionMock(...args),
      approveAgencyPromotion: (...args: unknown[]) => approveAgencyPromotionMock(...args),
      retireAgencyPromotion: (...args: unknown[]) => retireAgencyPromotionMock(...args),
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
  },
}));

const draft: AgencyRoleDraftSummary = {
  id: 'agency:engineering:code-reviewer',
  status: 'draft',
  sourceDivision: 'engineering',
  sourceAgentName: 'Code Reviewer',
  roleName: 'code-reviewer',
  displayName: 'Code Reviewer',
  description: 'Reviews code with bounded evidence.',
  capabilityHints: ['review'],
  toolHints: ['read', 'shell'],
  handoffHints: [],
  sourceRef: {
    relativePath: 'engineering/code-reviewer.md',
    sha256: 'a'.repeat(64),
  },
  roleCandidate: {
    name: 'code-reviewer',
    displayName: 'Code Reviewer',
    description: 'Reviews code with bounded evidence.',
    rolePrompt: 'Review code and report findings.',
    tools: [],
    effort: 'medium',
    permissions: {
      filesystem: 'read',
      network: 'none',
      commands: [],
    },
    tags: ['agency-draft'],
    outputFormat: 'markdown',
    outputSections: ['Summary', 'Evidence'],
    handoffTo: [],
    handoffFrom: [],
    requiresReview: true,
    riskProfile: 'medium',
  },
  validationIssues: [],
  toolMappingSuggestions: [
    { hint: 'read', candidateTools: ['read'] },
    { hint: 'shell', candidateTools: ['bash'] },
  ],
};

function record(
  lifecycle: AgencyRolePromotionRecord['lifecycle'],
): AgencyRolePromotionRecord {
  return {
    id: 'agency-review-1',
    draftId: draft.id,
    sourceRef: draft.sourceRef,
    lifecycle,
    evidenceQualification: 'scenario-verified',
    evidenceRefs: ['artifact://role/code-reviewer'],
    reviewer: 'release-operator',
    reviewedAt: '2026-07-12T10:00:00.000Z',
    ...(lifecycle === 'active' ? {
      decision: 'approved' as const,
      decidedBy: 'approver',
      decidedAt: '2026-07-12T10:05:00.000Z',
      materializedRoleName: 'agency-code-reviewer',
    } : {}),
    comment: 'Reviewed.',
    candidate: {
      ...draft.roleCandidate,
      name: 'agency-code-reviewer',
      tools: ['read'],
    },
    toolHintDispositions: [
      {
        hint: 'read',
        disposition: 'mapped',
        selectedTools: ['read'],
        reviewerNote: '',
      },
      {
        hint: 'shell',
        disposition: 'waived',
        selectedTools: [],
        reviewerNote: 'Shell is not required.',
      },
    ],
    contractSha256: 'b'.repeat(64),
    materialization: {
      status: lifecycle === 'active' ? 'complete' : 'not-started',
    },
  };
}

function renderPanel(onRoleMaterialized = vi.fn()) {
  return render(
    <TooltipProvider>
      <AgencyRolePromotionPanel onRoleMaterialized={onRoleMaterialized} />
    </TooltipProvider>,
  );
}

async function selectSource() {
  dialogOpenMock.mockResolvedValue({
    canceled: false,
    filePaths: ['C:\\agency-agents-main'],
  });
  agencyCatalogMock.mockResolvedValue({
    success: true,
    drafts: [draft],
    reviews: [],
  });
  fireEvent.click(screen.getByTestId('agency-source-select'));
  expect(await screen.findByText('Code Reviewer')).toBeVisible();
}

describe('AgencyRolePromotionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewAgencyPromotionMock.mockResolvedValue({
      success: true,
      persisted: false,
      validation: { ok: true, issues: [] },
      contractSha256: 'b'.repeat(64),
      role: { ...draft.roleCandidate, origin: 'config' },
    });
    reviewAgencyPromotionMock.mockResolvedValue({
      success: true,
      record: record('reviewed'),
      pendingRuntimeRefresh: false,
    });
    approveAgencyPromotionMock.mockResolvedValue({
      success: true,
      record: record('active'),
      pendingRuntimeRefresh: true,
    });
    retireAgencyPromotionMock.mockResolvedValue({
      success: true,
      record: {
        ...record('active'),
        lifecycle: 'retired',
        decision: 'retired',
      },
      pendingRuntimeRefresh: true,
    });
  });

  it('selects a directory and filters immutable Agency drafts', async () => {
    renderPanel();
    await selectSource();

    expect(dialogOpenMock).toHaveBeenCalledWith(expect.objectContaining({
      properties: ['openDirectory'],
    }));
    expect(agencyCatalogMock).toHaveBeenCalledWith({
      sourceRoot: 'C:\\agency-agents-main',
    });
    expect(screen.getByTestId('agency-source-path')).toHaveTextContent('C:\\agency-agents-main');
    expect(screen.getByTestId('agency-draft-status')).toHaveTextContent('roles.agencyPromotion.draft');

    fireEvent.change(screen.getByTestId('agency-catalog-search'), {
      target: { value: 'security' },
    });
    expect(screen.queryByText('Code Reviewer')).toBeNull();
    fireEvent.change(screen.getByTestId('agency-catalog-search'), {
      target: { value: 'engineering' },
    });
    expect(screen.getByText('Code Reviewer')).toBeVisible();
  });

  it('requires every hint to be explicitly mapped or waived', async () => {
    renderPanel();
    await selectSource();
    fireEvent.click(screen.getByText('Code Reviewer'));

    expect(screen.getByTestId('agency-promotion-review')).toBeDisabled();
    fireEvent.click(screen.getByTestId('agency-hint-read-map'));
    expect(screen.getByTestId('agency-promotion-review')).toBeDisabled();
    fireEvent.change(screen.getByTestId('agency-hint-read-tools'), {
      target: { value: 'read' },
    });
    fireEvent.click(screen.getByTestId('agency-hint-shell-waive'));
    fireEvent.change(screen.getByTestId('agency-hint-shell-note'), {
      target: { value: 'No shell access in the first release.' },
    });

    expect(screen.getByTestId('agency-promotion-review')).toBeEnabled();
    expect(screen.getByTestId('agency-hint-read-tools')).toHaveValue('read');
  });

  it('requires evidence for qualified review and approval only after review', async () => {
    renderPanel();
    await selectSource();
    fireEvent.click(screen.getByText('Code Reviewer'));
    fireEvent.click(screen.getByTestId('agency-hint-read-map'));
    fireEvent.change(screen.getByTestId('agency-hint-read-tools'), {
      target: { value: 'read' },
    });
    fireEvent.click(screen.getByTestId('agency-hint-shell-waive'));
    fireEvent.change(screen.getByTestId('agency-hint-shell-note'), {
      target: { value: 'Not needed.' },
    });
    fireEvent.change(screen.getByTestId('agency-evidence-qualification'), {
      target: { value: 'scenario-verified' },
    });

    expect(screen.getByTestId('agency-promotion-review')).toBeDisabled();
    expect(screen.queryByTestId('agency-promotion-approve')).toBeNull();
    fireEvent.change(screen.getByTestId('agency-evidence-refs'), {
      target: { value: 'artifact://role/code-reviewer' },
    });
    fireEvent.change(screen.getByTestId('agency-reviewer'), {
      target: { value: 'release-operator' },
    });
    fireEvent.click(screen.getByTestId('agency-promotion-review'));

    await waitFor(() => {
      expect(reviewAgencyPromotionMock).toHaveBeenCalledWith(expect.objectContaining({
        sourceRoot: 'C:\\agency-agents-main',
        draftId: draft.id,
        evidenceQualification: 'scenario-verified',
        evidenceRefs: ['artifact://role/code-reviewer'],
        toolHintDispositions: [
          expect.objectContaining({
            hint: 'read',
            disposition: 'mapped',
            selectedTools: ['read'],
          }),
          expect.objectContaining({
            hint: 'shell',
            disposition: 'waived',
            reviewerNote: 'Not needed.',
          }),
        ],
      }));
    });
    expect(await screen.findByTestId('agency-promotion-approve')).toBeEnabled();
  });

  it('confirms approval and retirement while keeping lifecycle separate from the draft', async () => {
    agencyCatalogMock.mockResolvedValue({
      success: true,
      drafts: [draft],
      reviews: [record('reviewed')],
    });
    dialogOpenMock.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\agency-agents-main'],
    });
    const onRoleMaterialized = vi.fn();
    renderPanel(onRoleMaterialized);
    fireEvent.click(screen.getByTestId('agency-source-select'));
    await screen.findByText('Code Reviewer');
    fireEvent.click(screen.getByText('Code Reviewer'));

    fireEvent.click(screen.getByTestId('agency-promotion-approve'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm-button'));
    await waitFor(() => expect(approveAgencyPromotionMock).toHaveBeenCalledWith({
      reviewId: 'agency-review-1',
      reviewer: 'release-operator',
      comment: 'Reviewed.',
    }));
    expect(await screen.findByTestId('agency-promotion-lifecycle')).toHaveTextContent(
      'roles.agencyPromotion.lifecycle.active',
    );
    expect(screen.getByTestId('agency-draft-status')).toHaveTextContent('roles.agencyPromotion.draft');
    expect(onRoleMaterialized).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('agency-promotion-retire'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm-button'));
    await waitFor(() => expect(retireAgencyPromotionMock).toHaveBeenCalled());
    expect(await screen.findByTestId('agency-promotion-lifecycle')).toHaveTextContent(
      'roles.agencyPromotion.lifecycle.retired',
    );
  });

  it('uses only the typed renderer facade', async () => {
    const source = await readFile(
      'src/components/agents/AgencyRolePromotionPanel.tsx',
      'utf8',
    );
    expect(source).not.toMatch(/ipcRenderer|127\.0\.0\.1:18789|gateway\.rpc/);
    expect(source).toContain('hostApi.roles');
    expect(source).toContain('hostApi.dialog.open');
  });
});
