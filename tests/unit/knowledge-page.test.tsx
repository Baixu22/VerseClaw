import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Knowledge } from '@/pages/Knowledge';

const hostApiMock = vi.hoisted(() => ({
  status: vi.fn(),
  init: vi.fn(),
  configure: vi.fn(),
  ingestFiles: vi.fn(),
  validateOkfBundle: vi.fn(),
  importOkfBundle: vi.fn(),
  createInboxItem: vi.fn(),
  listInboxItems: vi.fn(),
  updateInboxItem: vi.fn(),
  dismissInboxItem: vi.fn(),
  promoteInboxItemToDraft: vi.fn(),
  runtimeLessonsReport: vi.fn(),
  search: vi.fn(),
  get: vi.fn(),
  compile: vi.fn(),
  lint: vi.fn(),
  applyDraft: vi.fn(),
  createDraft: vi.fn(),
  listDrafts: vi.fn(),
  getDraft: vi.fn(),
  updateDraft: vi.fn(),
  reviewDraft: vi.fn(),
  proposeChange: vi.fn(),
  listProposals: vi.fn(),
  previewChange: vi.fn(),
  applyReviewedChange: vi.fn(),
  stewardReview: vi.fn(),
  recordKnowledgeReference: vi.fn(),
  getProvenance: vi.fn(),
  openVault: vi.fn(),
  dialogOpen: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    knowledge: {
      status: hostApiMock.status,
      init: hostApiMock.init,
      configure: hostApiMock.configure,
      ingestFiles: hostApiMock.ingestFiles,
      validateOkfBundle: hostApiMock.validateOkfBundle,
      importOkfBundle: hostApiMock.importOkfBundle,
      createInboxItem: hostApiMock.createInboxItem,
      listInboxItems: hostApiMock.listInboxItems,
      updateInboxItem: hostApiMock.updateInboxItem,
      dismissInboxItem: hostApiMock.dismissInboxItem,
      promoteInboxItemToDraft: hostApiMock.promoteInboxItemToDraft,
      runtimeLessonsReport: hostApiMock.runtimeLessonsReport,
      search: hostApiMock.search,
      get: hostApiMock.get,
      compile: hostApiMock.compile,
      lint: hostApiMock.lint,
      applyDraft: hostApiMock.applyDraft,
      createDraft: hostApiMock.createDraft,
      listDrafts: hostApiMock.listDrafts,
      getDraft: hostApiMock.getDraft,
      updateDraft: hostApiMock.updateDraft,
      reviewDraft: hostApiMock.reviewDraft,
      proposeChange: hostApiMock.proposeChange,
      listProposals: hostApiMock.listProposals,
      previewChange: hostApiMock.previewChange,
      applyReviewedChange: hostApiMock.applyReviewedChange,
      stewardReview: hostApiMock.stewardReview,
      recordKnowledgeReference: hostApiMock.recordKnowledgeReference,
      getProvenance: hostApiMock.getProvenance,
      openVault: hostApiMock.openVault,
    },
    dialog: {
      open: hostApiMock.dialogOpen,
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const labels: Record<string, string> = {
  title: 'Knowledge',
  subtitle: 'Manage source-backed wiki context for OpenClaw runs.',
  'actions.configure': 'Configure',
  'actions.init': 'Initialize',
  'actions.importFiles': 'Import Files',
  'actions.importFolder': 'Import Folder',
  'actions.validateOkf': 'Validate OKF Bundle',
  'actions.importOkf': 'Import OKF Bundle',
  'actions.compile': 'Compile',
  'actions.lint': 'Lint',
  'actions.openVault': 'Open Vault',
  'status.title': 'Vault Status',
  'status.ready': 'Ready',
  'status.missing': 'Missing',
  'status.vault': 'Vault',
  'status.mode': 'Mode',
  'status.render': 'Render',
  'status.obsidian': 'Obsidian CLI',
  'status.available': 'Available',
  'status.unavailable': 'Unavailable',
  'status.nativeSources': 'Native sources',
  'metrics.sources': 'Sources',
  'metrics.syntheses': 'Syntheses',
  'metrics.entities': 'Entities',
  'metrics.warnings': 'Warnings',
  'search.title': 'Search',
  'search.placeholder': 'Search wiki sources and syntheses',
  'search.empty': 'No matching knowledge found.',
  'search.preview': 'Preview',
  'search.useInDraft': 'Use in draft',
  'okf.title': 'OKF Compatibility',
  'okf.badge': 'OKF v0.1',
  'okf.bundlePath': 'Bundle',
  'okf.concepts': 'Concepts',
  'okf.validConcepts': 'Valid',
  'okf.reservedFiles': 'Reserved',
  'okf.warnings': 'Warnings',
  'okf.errors': 'Errors',
  'okf.typeDistribution': 'Types',
  'okf.selectAll': 'Select all valid concepts',
  'tabs.library': 'Library',
  'tabs.inbox': 'Inbox',
  'tabs.drafts': 'Draft Inbox',
  'tabs.review': 'Review',
  'tabs.governance': 'Governance',
  'tabs.runtime': 'Runtime Lessons',
  'library.title': 'Library',
  'library.typeHint': 'Filter and browse this knowledge type',
  'inbox.title': 'Knowledge Inbox',
  'inbox.pending': 'Pending candidates',
  'inbox.empty': 'No pending knowledge candidates.',
  'inbox.noSelection': 'No inbox item selected.',
  'inbox.noSelectionHint': 'Select a candidate to inspect provenance before promoting it.',
  'inbox.promote': 'Promote to Draft',
  'inbox.dismiss': 'Dismiss',
  'inbox.sources': 'Sources',
  'inbox.noSources': 'No source references attached.',
  'inbox.warnings': 'Warnings',
  'inbox.noWarnings': 'No warnings.',
  'inbox.kinds.chat-session': 'Chat',
  'inbox.kinds.task-ledger': 'Task Ledger',
  'inbox.kinds.clawgraph': 'ClawGraph',
  'inbox.kinds.file': 'File',
  'inbox.kinds.okf': 'OKF',
  'inbox.kinds.manual': 'Manual',
  'inbox.kinds.wiki-result': 'Wiki',
  'provenance.references': '1 reference',
  'types.source-note': 'Source Notes',
  'types.synthesis': 'Syntheses',
  'types.decision': 'Decisions',
  'types.architecture': 'Architecture',
  'types.command': 'Commands',
  'types.troubleshooting': 'Troubleshooting',
  'types.glossary': 'Glossary',
  'types.procedure': 'Procedures',
  'draft.title': 'Draft Inbox',
  'draft.titleLabel': 'Title',
  'draft.typeLabel': 'Type',
  'draft.sourcesLabel': 'Source IDs',
  'draft.tagsLabel': 'Tags',
  'draft.bodyLabel': 'Body',
  'draft.apply': 'Apply Draft',
  'draft.create': 'Create Draft',
  'draft.askSteward': 'Ask Steward to Review',
  'draft.empty': 'No knowledge drafts yet.',
  'draft.defaultProposalReason': 'User-created knowledge draft awaiting explicit review and apply.',
  'draft.status.draft': 'Draft',
  'draft.status.steward_reviewed': 'Reviewed',
  'draft.status.approved': 'Approved',
  'draft.status.rejected': 'Rejected',
  'draft.status.applied': 'Applied',
  'review.title': 'Review / Diff',
  'review.noDraft': 'No draft selected.',
  'review.diffTitle': 'Change Preview',
  'review.noProposal': 'No proposal selected.',
  'review.confirmationBoundary': 'Agents and the Knowledge Steward can only prepare drafts or proposals. Applying knowledge requires this explicit user confirmation.',
  'review.approveAndApply': 'Approve and Apply',
  'review.reject': 'Reject',
  'runtime.title': 'Runtime Lessons',
  'runtime.subtitle': 'SEKB runtime learning from agent runs.',
  'runtime.unavailable': 'Runtime lessons are not available.',
  'runtime.metrics.trajectories': 'Trajectories',
  'runtime.metrics.undistilled': 'Undistilled',
  'runtime.metrics.principles': 'Principles',
  'runtime.undistilledTitle': 'Undistilled runs',
  'runtime.principlesTitle': 'Active principles',
  'runtime.indexTitle': 'Index preview',
  'runtime.emptyUndistilled': 'No undistilled runtime runs.',
  'runtime.emptyPrinciples': 'No active runtime principles.',
  'runtime.errorSignature': 'Error signature',
  'runtime.taskType': 'Task type',
  'governance.title': 'Governance',
  'governance.readOnlyBadge': 'Agent read-only by default',
  'governance.steward': 'Knowledge Steward',
  'governance.stewardDescription': 'A role-first slot.',
  'governance.permissions': 'Permission Boundary',
  'governance.permissionsDescription': 'Chat knowledge scope only grants search/get access.',
  'governance.lastReview': 'Latest Steward Review',
  'governance.noReview': 'No steward review has run.',
  'dialogs.pickFiles': 'Import knowledge files',
  'dialogs.pickFolder': 'Import a knowledge folder',
  'dialogs.pickOkfBundle': 'Select an OKF bundle folder',
  'toasts.init': 'Knowledge vault initialized',
  'toasts.ingest': 'Knowledge imported',
  'toasts.validateOkf': 'OKF bundle validated',
  'toasts.importOkf': 'OKF concepts imported',
  'toasts.compile': 'Knowledge compiled',
  'toasts.lint': 'Knowledge lint complete',
  'toasts.applyDraft': 'Draft applied',
  'toasts.createDraft': 'Draft created for review',
  'toasts.promoteInbox': 'Inbox item promoted to draft',
  'toasts.dismissInbox': 'Inbox item dismissed',
  'toasts.stewardReview': 'Steward review updated',
  'toasts.applyReviewedChange': 'Reviewed change applied',
  'toasts.rejectDraft': 'Draft rejected',
  'errors.status': 'Failed to load knowledge status.',
  'errors.action': 'Knowledge action failed.',
  'errors.okfValidation': 'OKF validation failed.',
  'errors.okfImport': 'OKF import failed.',
  'errors.search': 'Search failed.',
  'errors.get': 'Failed to load knowledge page.',
  'common:actions.refresh': 'Refresh',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => labels[key] ?? key,
  }),
}));

describe('Knowledge page', () => {
  beforeEach(() => {
    hostApiMock.status.mockReset();
    hostApiMock.init.mockReset();
    hostApiMock.configure.mockReset();
    hostApiMock.ingestFiles.mockReset();
    hostApiMock.validateOkfBundle.mockReset();
    hostApiMock.importOkfBundle.mockReset();
    hostApiMock.createInboxItem.mockReset();
    hostApiMock.listInboxItems.mockReset();
    hostApiMock.updateInboxItem.mockReset();
    hostApiMock.dismissInboxItem.mockReset();
    hostApiMock.promoteInboxItemToDraft.mockReset();
    hostApiMock.runtimeLessonsReport.mockReset();
    hostApiMock.search.mockReset();
    hostApiMock.get.mockReset();
    hostApiMock.compile.mockReset();
    hostApiMock.lint.mockReset();
    hostApiMock.applyDraft.mockReset();
    hostApiMock.createDraft.mockReset();
    hostApiMock.listDrafts.mockReset();
    hostApiMock.getDraft.mockReset();
    hostApiMock.updateDraft.mockReset();
    hostApiMock.reviewDraft.mockReset();
    hostApiMock.proposeChange.mockReset();
    hostApiMock.listProposals.mockReset();
    hostApiMock.previewChange.mockReset();
    hostApiMock.applyReviewedChange.mockReset();
    hostApiMock.stewardReview.mockReset();
    hostApiMock.recordKnowledgeReference.mockReset();
    hostApiMock.getProvenance.mockReset();
    hostApiMock.openVault.mockReset();
    hostApiMock.dialogOpen.mockReset();

    hostApiMock.status.mockResolvedValue({
      success: true,
      status: {
        vaultExists: false,
        vaultPath: 'C:/clawx/wiki',
        vaultMode: 'isolated',
        renderMode: 'native',
        pageCounts: { source: 1, synthesis: 0 },
        sourceCounts: { native: 1 },
        warnings: [],
        obsidianCli: { available: false },
      },
    });
    hostApiMock.init.mockResolvedValue({ success: true });
    hostApiMock.configure.mockResolvedValue({ success: true });
    hostApiMock.ingestFiles.mockResolvedValue({ success: true, items: [], scanned: 1, imported: 1, failed: 0 });
    hostApiMock.validateOkfBundle.mockResolvedValue({
      success: true,
      bundleId: 'okf-test',
      bundlePath: 'C:/okf',
      okfVersion: '0.1',
      summary: {
        scannedFiles: 4,
        markdownFiles: 4,
        conceptFiles: 2,
        validConcepts: 2,
        reservedFiles: 2,
        warnings: 1,
        errors: 0,
        truncated: false,
      },
      typeDistribution: { architecture: 1, decision: 1 },
      concepts: [{
        conceptId: 'guides/alpha',
        filePath: 'C:/okf/guides/alpha.md',
        frontmatter: { type: 'architecture', title: 'Alpha', resource: 'local', timestamp: '2026-06-20' },
        bodyPreview: 'Alpha architecture note.',
        links: ['missing.md'],
        citations: [],
        warnings: [{ code: 'brokenLink', message: 'Broken OKF link: missing.md', conceptId: 'guides/alpha' }],
      }, {
        conceptId: 'beta',
        filePath: 'C:/okf/beta.md',
        frontmatter: { type: 'decision', title: 'Beta' },
        bodyPreview: 'Beta decision note.',
        links: [],
        citations: [],
        warnings: [],
      }],
      warnings: [{ code: 'brokenLink', message: 'Broken OKF link: missing.md', conceptId: 'guides/alpha' }],
      errors: [],
    });
    hostApiMock.importOkfBundle.mockResolvedValue({
      success: true,
      bundleId: 'okf-test',
      bundlePath: 'C:/okf',
      imported: 1,
      skipped: 1,
      failed: 0,
      items: [{ conceptId: 'guides/alpha', inputPath: 'C:/okf/guides/alpha.md', pageId: 'alpha' }],
      mappingPath: 'C:/config/knowledge/okf/bundles/okf-test.json',
    });
    hostApiMock.listInboxItems.mockResolvedValue({
      success: true,
      items: [{
        id: 'inbox-1',
        title: 'Task decision candidate',
        body: 'Use Knowledge Inbox before writing formal wiki pages.',
        kind: 'task-ledger',
        type: 'decision',
        status: 'pending',
        sourceIds: ['task-1'],
        sourceRefs: [{ id: 'task-1', kind: 'task_ledger', label: 'Task Ledger decision' }],
        tags: ['governance'],
        workspaceId: null,
        agentId: null,
        createdBy: 'agent',
        warnings: ['Needs user review before writing.'],
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
      }],
    });
    hostApiMock.promoteInboxItemToDraft.mockResolvedValue({
      success: true,
      item: { id: 'inbox-1', status: 'promoted' },
      draft: {
        id: 'draft-inbox-1',
        title: 'Task decision candidate',
        body: 'Use Knowledge Inbox before writing formal wiki pages.',
        type: 'decision',
        status: 'draft',
        sourceIds: ['task-1'],
        sourceRefs: [],
        tags: ['governance'],
        workspaceId: null,
        agentId: null,
        createdBy: 'agent',
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
      },
      proposal: {
        id: 'proposal-inbox-1',
        operation: 'create',
        status: 'proposed',
        draftId: 'draft-inbox-1',
        reason: 'Knowledge Inbox item promoted to an editable draft for explicit review and apply.',
        sources: [{ id: 'task-1', kind: 'task_ledger' }],
        requiresUserConfirmation: true,
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
      },
    });
    hostApiMock.dismissInboxItem.mockResolvedValue({ success: true, item: { id: 'inbox-1', status: 'dismissed' } });
    hostApiMock.runtimeLessonsReport.mockResolvedValue({
      success: true,
      available: true,
      counts: { trajectories: 5, undistilledTrajectories: 2, activePrinciples: 1 },
      undistilled: [{
        trajectory_id: 'traj-runtime-1',
        created_at: '2026-07-06T00:00:00.000Z',
        task_intent: 'Recover from failed Knowledge import',
        task_type: 'coding',
        context_fingerprint: ['knowledge', 'runtime-lessons'],
        outcome: 'failure',
        error_signature: 'ImportError::knowledge_runtime_lessons',
      }],
      activePrinciples: [{
        principle_id: 'principle-runtime-1',
        title: 'Inspect runtime lessons before changing Knowledge flows',
        task_types: ['coding'],
        context_tags: ['knowledge'],
        criticality: 'medium',
        retrieval_count: 3,
        adoption_count: 1,
      }],
      indexPreview: 'Runtime lesson index preview',
    });
    hostApiMock.recordKnowledgeReference.mockResolvedValue({
      success: true,
      record: {
        id: 'kpv-1',
        targetId: 'notes/decision.md',
        targetKind: 'wiki-page',
        title: 'Decision',
        sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md' }],
        references: [{ id: 'ref-1', kind: 'search', lookup: 'notes/decision.md', timestamp: '2026-06-20T00:00:00.000Z' }],
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
      },
    });
    hostApiMock.search.mockResolvedValue({
      success: true,
      results: [{ pagePath: 'notes/decision.md', title: 'Decision', snippet: 'Use native wiki.' }],
    });
    hostApiMock.get.mockResolvedValue({ success: true, content: '# Decision\nUse native wiki.' });
    hostApiMock.compile.mockResolvedValue({ success: true });
    hostApiMock.lint.mockResolvedValue({ success: true });
    hostApiMock.applyDraft.mockResolvedValue({ success: true });
    hostApiMock.listDrafts.mockResolvedValue({
      success: true,
      drafts: [{
        id: 'draft-1',
        title: 'Session synthesis',
        body: 'Use native wiki for the MVP.',
        type: 'synthesis',
        status: 'draft',
        sourceIds: ['notes/decision.md'],
        sourceRefs: [],
        tags: [],
        workspaceId: null,
        agentId: null,
        createdBy: 'user',
        createdAt: '2026-06-19T00:00:00.000Z',
        updatedAt: '2026-06-19T00:00:00.000Z',
      }],
    });
    hostApiMock.listProposals.mockResolvedValue({
      success: true,
      proposals: [{
        id: 'proposal-1',
        operation: 'create',
        status: 'proposed',
        draftId: 'draft-1',
        reason: 'User-created knowledge draft awaiting explicit review and apply.',
        sources: [{ id: 'notes/decision.md', kind: 'manual' }],
        requiresUserConfirmation: true,
        createdAt: '2026-06-19T00:00:00.000Z',
        updatedAt: '2026-06-19T00:00:00.000Z',
      }],
    });
    hostApiMock.createDraft.mockResolvedValue({
      success: true,
      draft: {
        id: 'draft-1',
        title: 'Session synthesis',
        body: 'Use native wiki for the MVP.',
        type: 'synthesis',
        status: 'draft',
        sourceIds: ['notes/decision.md'],
        sourceRefs: [],
        tags: [],
        workspaceId: null,
        agentId: null,
        createdBy: 'user',
        createdAt: '2026-06-19T00:00:00.000Z',
        updatedAt: '2026-06-19T00:00:00.000Z',
      },
    });
    hostApiMock.proposeChange.mockResolvedValue({
      success: true,
      proposal: {
        id: 'proposal-1',
        operation: 'create',
        status: 'proposed',
        draftId: 'draft-1',
        reason: 'User-created knowledge draft awaiting explicit review and apply.',
        sources: [{ id: 'notes/decision.md', kind: 'manual' }],
        requiresUserConfirmation: true,
        createdAt: '2026-06-19T00:00:00.000Z',
        updatedAt: '2026-06-19T00:00:00.000Z',
      },
    });
    hostApiMock.reviewDraft.mockResolvedValue({ success: true, draft: { id: 'draft-1', status: 'approved' } });
    hostApiMock.applyReviewedChange.mockResolvedValue({ success: true });
    hostApiMock.stewardReview.mockResolvedValue({
      success: true,
      type: 'synthesis',
      tags: ['synthesis'],
      warnings: ['Missing source references. User confirmation is still required before writing.'],
      notes: 'Advisory only.',
      config: {
        enabled: true,
        roleId: 'knowledge-steward',
        capabilities: { canApplyDirectly: false },
        scope: { workspace: true, agent: false, global: false },
      },
    });
    hostApiMock.openVault.mockResolvedValue({ success: true, path: 'C:/clawx/wiki' });
    hostApiMock.dialogOpen.mockResolvedValue({ canceled: false, filePaths: ['C:/notes/decision.md'] });
  });

  it('initializes, imports, searches, opens results, and applies drafts', async () => {
    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    await waitFor(() => expect(hostApiMock.status).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Initialize'));
    await waitFor(() => expect(hostApiMock.init).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Import Files')).not.toBeDisabled());

    fireEvent.click(screen.getByText('Import Files'));
    await waitFor(() => expect(hostApiMock.ingestFiles).toHaveBeenCalledWith({ paths: ['C:/notes/decision.md'] }));
    await waitFor(() => expect(screen.getByText('Compile')).not.toBeDisabled());

    fireEvent.click(screen.getByText('Compile'));
    await waitFor(() => expect(hostApiMock.compile).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Lint')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Lint'));
    await waitFor(() => expect(hostApiMock.lint).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('knowledge-search-input'), { target: { value: 'native wiki' } });
    await waitFor(() => expect(screen.getByTestId('knowledge-search-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('knowledge-search-submit'));
    await screen.findByText('Decision');

    fireEvent.click(screen.getByTestId('knowledge-search-result'));
    await screen.findByText(/Use native wiki/);
    expect(hostApiMock.get).toHaveBeenCalledWith({ lookup: 'notes/decision.md', lineCount: 120, corpus: 'wiki' });
    expect(hostApiMock.recordKnowledgeReference).toHaveBeenCalledWith({
      targetId: 'notes/decision.md',
      targetKind: 'wiki-page',
      title: 'Decision',
      sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md' }],
      reference: { kind: 'search', lookup: 'notes/decision.md', query: 'native wiki' },
    });
    fireEvent.click(screen.getByTestId('knowledge-use-result-draft'));
    expect(screen.getByTestId('knowledge-draft-title')).toHaveValue('Decision');
    expect(screen.getByTestId('knowledge-draft-sources')).toHaveValue('notes/decision.md');
    expect(screen.getByTestId('knowledge-draft-body')).toHaveValue('# Decision\nUse native wiki.');

    fireEvent.change(screen.getByTestId('knowledge-draft-title'), { target: { value: 'Session synthesis' } });
    fireEvent.change(screen.getByTestId('knowledge-draft-sources'), { target: { value: 'notes/decision.md' } });
    fireEvent.change(screen.getByTestId('knowledge-draft-body'), { target: { value: 'Use native wiki for the MVP.' } });
    await waitFor(() => expect(screen.getByTestId('knowledge-draft-apply')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('knowledge-draft-apply'));

    await waitFor(() => expect(hostApiMock.createDraft).toHaveBeenCalledWith({
      title: 'Session synthesis',
      body: 'Use native wiki for the MVP.',
      type: 'synthesis',
      sourceIds: ['notes/decision.md'],
      tags: [],
      createdBy: 'user',
    }));
    expect(hostApiMock.applyDraft).not.toHaveBeenCalled();
    await waitFor(() => expect(hostApiMock.proposeChange).toHaveBeenCalledWith({
      operation: 'create',
      draftId: 'draft-1',
      reason: 'User-created knowledge draft awaiting explicit review and apply.',
      sources: [{ id: 'notes/decision.md', kind: 'manual' }],
    }));

    fireEvent.click(screen.getByTestId('knowledge-review-apply'));
    await waitFor(() => expect(hostApiMock.reviewDraft).toHaveBeenCalledWith({ id: 'draft-1', action: 'approve', stewardNotes: undefined }));
    await waitFor(() => expect(hostApiMock.applyReviewedChange).toHaveBeenCalledWith({ id: 'proposal-1' }));
  });

  it('shows inbox candidates and promotes them into draft review without applying', async () => {
    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    await screen.findByText('Inbox');
    fireEvent.click(screen.getByTestId('knowledge-tab-inbox'));

    await screen.findByTestId('knowledge-inbox');
    expect(screen.getAllByText('Task decision candidate').length).toBeGreaterThan(0);
    expect(screen.getByText('Needs user review before writing.')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('knowledge-inbox-promote'));
    await waitFor(() => expect(hostApiMock.promoteInboxItemToDraft).toHaveBeenCalledWith({ id: 'inbox-1' }));
    expect(hostApiMock.applyDraft).not.toHaveBeenCalled();
    expect(hostApiMock.applyReviewedChange).not.toHaveBeenCalled();
  });

  it('shows SEKB runtime lessons as a read-only Knowledge tab', async () => {
    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    fireEvent.click(await screen.findByTestId('knowledge-tab-runtime'));

    const runtimePanel = await screen.findByTestId('knowledge-runtime-lessons');
    expect(hostApiMock.runtimeLessonsReport).toHaveBeenCalledTimes(1);
    expect(within(runtimePanel).getByText('Runtime Lessons')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Recover from failed Knowledge import')).toBeInTheDocument();
    expect(screen.getByText('ImportError::knowledge_runtime_lessons')).toBeInTheDocument();
    expect(screen.getByText('Inspect runtime lessons before changing Knowledge flows')).toBeInTheDocument();
    expect(screen.getByText('Runtime lesson index preview')).toBeInTheDocument();
    expect(screen.queryByText('Approve and Apply')).not.toBeInTheDocument();
  });

  it('validates an OKF folder and imports only user-selected concepts', async () => {
    hostApiMock.dialogOpen.mockResolvedValueOnce({ canceled: false, filePaths: ['C:/okf'] });
    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    fireEvent.click(screen.getByText('Validate OKF Bundle'));

    await waitFor(() => expect(hostApiMock.validateOkfBundle).toHaveBeenCalledWith({ path: 'C:/okf' }));
    await screen.findByTestId('knowledge-okf-panel');
    expect(screen.getByText('OKF Compatibility')).toBeInTheDocument();
    expect(screen.getByText('architecture: 1')).toBeInTheDocument();
    expect(screen.getAllByText('Broken OKF link: missing.md').length).toBeGreaterThan(0);

    const concepts = screen.getAllByTestId('knowledge-okf-concept');
    expect(concepts).toHaveLength(2);
    fireEvent.click(within(concepts[1]).getByRole('checkbox'));

    await waitFor(() => {
      expect(screen.getByTestId('knowledge-okf-import')).not.toBeDisabled();
      expect(screen.getByTestId('knowledge-okf-import')).toHaveTextContent('Import OKF Bundle (1)');
    });
    fireEvent.click(screen.getByTestId('knowledge-okf-import'));

    await waitFor(() => expect(hostApiMock.importOkfBundle).toHaveBeenCalledWith({
      path: 'C:/okf',
      conceptIds: ['guides/alpha'],
    }));
  });
});
