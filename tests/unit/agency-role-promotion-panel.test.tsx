import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgencyRolePromotionPanel } from '@/components/agents/AgencyRolePromotionPanel';
import type {
  AgencyRoleDraftSummary,
  AgencyRolePackageSummary,
  AgencyRolePromotionRecord,
} from '@shared/host-api/contract';

const {
  agencyCatalogMock,
  approveAgencyPromotionMock,
  dialogOpenMock,
  importAgencyPackageMock,
  listAgencyPackagesMock,
  memoryPreviewProposalMock,
  memoryProposeMock,
  previewAgencyMemoryProposalsMock,
  previewAgencyPromotionMock,
  refreshAgencyPackageMock,
  retireAgencyPromotionMock,
  reviewAgencyPromotionMock,
} = vi.hoisted(() => ({
  agencyCatalogMock: vi.fn(),
  approveAgencyPromotionMock: vi.fn(),
  dialogOpenMock: vi.fn(),
  importAgencyPackageMock: vi.fn(),
  listAgencyPackagesMock: vi.fn(),
  memoryPreviewProposalMock: vi.fn(),
  memoryProposeMock: vi.fn(),
  previewAgencyMemoryProposalsMock: vi.fn(),
  previewAgencyPromotionMock: vi.fn(),
  refreshAgencyPackageMock: vi.fn(),
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
      listAgencyPackages: (...args: unknown[]) => listAgencyPackagesMock(...args),
      importAgencyPackage: (...args: unknown[]) => importAgencyPackageMock(...args),
      refreshAgencyPackage: (...args: unknown[]) => refreshAgencyPackageMock(...args),
      previewAgencyPromotion: (...args: unknown[]) => previewAgencyPromotionMock(...args),
      previewAgencyMemoryProposals: (...args: unknown[]) => (
        previewAgencyMemoryProposalsMock(...args)
      ),
      reviewAgencyPromotion: (...args: unknown[]) => reviewAgencyPromotionMock(...args),
      approveAgencyPromotion: (...args: unknown[]) => approveAgencyPromotionMock(...args),
      retireAgencyPromotion: (...args: unknown[]) => retireAgencyPromotionMock(...args),
    },
    memory: {
      previewProposal: (...args: unknown[]) => memoryPreviewProposalMock(...args),
      propose: (...args: unknown[]) => memoryProposeMock(...args),
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

const rolePackage: AgencyRolePackageSummary = {
  packageId: 'c'.repeat(64),
  draftId: draft.id,
  sourceRef: draft.sourceRef,
  completeness: 'complete',
  importedAt: '2026-07-12T09:00:00.000Z',
  sourceDivision: 'engineering',
  matchedRunbooks: ['engineering-review'],
  draft,
};

function record(
  lifecycle: AgencyRolePromotionRecord['lifecycle'],
): AgencyRolePromotionRecord {
  return {
    id: 'agency-review-1',
    packageId: rolePackage.packageId,
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

function renderPanel(
  onRoleMaterialized = vi.fn(),
  options: { roleMemoryEnabled?: boolean; onMemoryProposed?: () => void } = {},
) {
  return render(
    <TooltipProvider>
      <AgencyRolePromotionPanel
        onRoleMaterialized={onRoleMaterialized}
        roleMemoryEnabled={options.roleMemoryEnabled ?? true}
        onMemoryProposed={options.onMemoryProposed}
      />
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

async function importDraft() {
  await selectSource();
  fireEvent.click(screen.getByTestId(`agency-import-${draft.id}`));
  expect(await screen.findByTestId(`agency-package-${rolePackage.packageId}`)).toBeVisible();
}

describe('AgencyRolePromotionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAgencyPackagesMock.mockResolvedValue({
      success: true,
      packages: [],
      reviews: [],
    });
    importAgencyPackageMock.mockResolvedValue({
      success: true,
      package: rolePackage,
    });
    refreshAgencyPackageMock.mockResolvedValue({
      success: true,
      package: rolePackage,
    });
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
    previewAgencyMemoryProposalsMock.mockResolvedValue({
      success: true,
      packageId: rolePackage.packageId,
      reviewId: 'agency-review-1',
      materializedRoleName: 'agency-code-reviewer',
      candidates: [
        {
          sectionId: 'section-constraint',
          type: 'constraint',
          headingPath: ['Critical Rules'],
          content: 'Never approve without evidence.',
          proposal: {
            type: 'constraint',
            scope: 'role',
            scopeKey: 'agency-code-reviewer',
            ownerRole: 'agency-code-reviewer',
            applicableRoles: ['agency-code-reviewer'],
            roleTags: ['agency-code-reviewer'],
            content: 'Never approve without evidence.',
            confidence: 0.6,
            importance: 0.8,
            sensitivity: 'normal',
            durability: 'long_term',
            source: 'system',
          },
        },
      ],
    });
    memoryPreviewProposalMock.mockResolvedValue({
      success: true,
      preview: {
        decision: { action: 'needs_review', accepted: false },
        conflicts: [],
        wouldWrite: false,
      },
    });
    memoryProposeMock.mockResolvedValue({
      success: true,
      action: 'needs_review',
      accepted: false,
      reason: 'Manual review required.',
    });
  });

  it('loads the local library without an external source', async () => {
    listAgencyPackagesMock.mockResolvedValue({
      success: true,
      packages: [rolePackage],
      reviews: [],
    });
    renderPanel();

    expect(await screen.findByTestId(`agency-package-${rolePackage.packageId}`)).toBeVisible();
    expect(listAgencyPackagesMock).toHaveBeenCalledWith();
    expect(screen.queryByTestId('agency-source-path')).toBeNull();
  });

  it('selects a directory, filters external drafts, and imports one role', async () => {
    renderPanel();
    await selectSource();

    expect(dialogOpenMock).toHaveBeenCalledWith(expect.objectContaining({
      properties: ['openDirectory'],
    }));
    expect(agencyCatalogMock).toHaveBeenCalledWith({
      sourceRoot: 'C:\\agency-agents-main',
    });
    expect(screen.getByTestId('agency-source-path')).toHaveTextContent('C:\\agency-agents-main');
    expect(screen.getByTestId('agency-external-draft-status')).toHaveTextContent(
      'roles.agencyPromotion.draft',
    );

    fireEvent.change(screen.getByTestId('agency-catalog-search'), {
      target: { value: 'security' },
    });
    expect(screen.queryByText('Code Reviewer')).toBeNull();
    fireEvent.change(screen.getByTestId('agency-catalog-search'), {
      target: { value: 'engineering' },
    });
    expect(screen.getByText('Code Reviewer')).toBeVisible();

    fireEvent.click(screen.getByTestId(`agency-import-${draft.id}`));
    await waitFor(() => expect(importAgencyPackageMock).toHaveBeenCalledWith({
      sourceRoot: 'C:\\agency-agents-main',
      draftId: draft.id,
    }));
    expect(await screen.findByTestId('agency-local-library')).toHaveTextContent('Code Reviewer');
  });

  it('requires every hint to be explicitly mapped or waived', async () => {
    renderPanel();
    await importDraft();
    fireEvent.click(screen.getByTestId(`agency-package-${rolePackage.packageId}`));

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
    await importDraft();
    fireEvent.click(screen.getByTestId(`agency-package-${rolePackage.packageId}`));
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
        packageId: rolePackage.packageId,
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
    const payload = reviewAgencyPromotionMock.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty('sourceRoot');
    expect(payload).not.toHaveProperty('draftId');
    expect(await screen.findByTestId('agency-promotion-approve')).toBeEnabled();
  });

  it('confirms approval and retirement while keeping lifecycle separate from the draft', async () => {
    listAgencyPackagesMock.mockResolvedValue({
      success: true,
      packages: [rolePackage],
      reviews: [record('reviewed')],
    });
    const onRoleMaterialized = vi.fn();
    renderPanel(onRoleMaterialized);
    fireEvent.click(await screen.findByTestId(`agency-package-${rolePackage.packageId}`));

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

  it('refreshes a local package from an explicitly reselected source', async () => {
    listAgencyPackagesMock.mockResolvedValue({
      success: true,
      packages: [rolePackage],
      reviews: [],
    });
    const updatedPackage = {
      ...rolePackage,
      packageId: 'd'.repeat(64),
      supersedesPackageId: rolePackage.packageId,
    };
    refreshAgencyPackageMock.mockResolvedValue({
      success: true,
      package: updatedPackage,
    });
    dialogOpenMock.mockResolvedValue({
      canceled: false,
      filePaths: ['D:\\agency-agents-main'],
    });
    renderPanel();

    fireEvent.click(await screen.findByTestId(`agency-package-refresh-${rolePackage.packageId}`));
    await waitFor(() => expect(refreshAgencyPackageMock).toHaveBeenCalledWith({
      packageId: rolePackage.packageId,
      sourceRoot: 'D:\\agency-agents-main',
    }));
    expect(await screen.findByTestId(`agency-package-${updatedPackage.packageId}`)).toBeVisible();
    expect(screen.getByTestId(`agency-package-${rolePackage.packageId}`)).toHaveTextContent(
      'roles.agencyPromotion.newerVersion',
    );
  });

  it('marks reconstructed packages whose source body was not archived', async () => {
    listAgencyPackagesMock.mockResolvedValue({
      success: true,
      packages: [{ ...rolePackage, completeness: 'legacy-reconstructed' }],
      reviews: [],
    });
    renderPanel();

    fireEvent.click(await screen.findByTestId(`agency-package-${rolePackage.packageId}`));
    expect(screen.getByTestId('agency-package-reconstructed-warning')).toHaveTextContent(
      'roles.agencyPromotion.reconstructedWarning',
    );
  });

  it('previews and submits selected Agency sections through the memory gatekeeper', async () => {
    listAgencyPackagesMock.mockResolvedValue({
      success: true,
      packages: [rolePackage],
      reviews: [record('active')],
    });
    const onMemoryProposed = vi.fn();
    renderPanel(vi.fn(), { onMemoryProposed });
    fireEvent.click(await screen.findByTestId(`agency-package-${rolePackage.packageId}`));

    fireEvent.click(screen.getByTestId('agency-memory-extract'));
    expect(await screen.findByTestId('agency-memory-candidate-section-constraint')).toHaveTextContent(
      'Never approve without evidence.',
    );
    expect(previewAgencyMemoryProposalsMock).toHaveBeenCalledWith({
      packageId: rolePackage.packageId,
      reviewId: 'agency-review-1',
    });

    fireEvent.click(screen.getByTestId('agency-memory-preview'));
    await waitFor(() => expect(memoryPreviewProposalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'constraint',
        confidence: 0.6,
        scopeKey: 'agency-code-reviewer',
      }),
    ));
    expect(screen.getByTestId('agency-memory-candidate-section-constraint')).toHaveTextContent(
      'roles.agencyPromotion.memory.needsReview',
    );

    fireEvent.click(screen.getByTestId('agency-memory-submit'));
    await waitFor(() => expect(memoryProposeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Never approve without evidence.',
        confidence: 0.6,
      }),
    ));
    expect(onMemoryProposed).toHaveBeenCalled();
  });

  it('keeps packages usable while memory proposal controls are disabled', async () => {
    listAgencyPackagesMock.mockResolvedValue({
      success: true,
      packages: [rolePackage],
      reviews: [record('active')],
    });
    renderPanel(vi.fn(), { roleMemoryEnabled: false });
    fireEvent.click(await screen.findByTestId(`agency-package-${rolePackage.packageId}`));

    expect(screen.getByTestId('agency-memory-disabled')).toBeVisible();
    expect(screen.getByTestId('agency-memory-extract')).toBeDisabled();
    expect(screen.getByTestId(`agency-package-refresh-${rolePackage.packageId}`)).toBeEnabled();
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
