import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  search: vi.fn(),
  get: vi.fn(),
  compile: vi.fn(),
  lint: vi.fn(),
  applyDraft: vi.fn(),
  createDraft: vi.fn(),
  listSourceSets: vi.fn(),
  saveSourceSet: vi.fn(),
  deleteSourceSet: vi.fn(),
  answerFromSourceSet: vi.fn(),
  createArtifactDraft: vi.fn(),
  listDrafts: vi.fn(),
  getDraft: vi.fn(),
  updateDraft: vi.fn(),
  reviewDraft: vi.fn(),
  proposeChange: vi.fn(),
  listProposals: vi.fn(),
  previewChange: vi.fn(),
  applyReviewedChange: vi.fn(),
  stewardReview: vi.fn(),
  governanceAudit: vi.fn(),
  recordKnowledgeReference: vi.fn(),
  getProvenance: vi.fn(),
  openVault: vi.fn(),
  stewardConfigGet: vi.fn(),
  stewardConfigUpdate: vi.fn(),
  dialogOpen: vi.fn(),
}));

const i18nTest = vi.hoisted(() => ({
  t: ((key: string, _options?: Record<string, unknown>) => key) as (key: string, options?: Record<string, unknown>) => string,
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
      search: hostApiMock.search,
      get: hostApiMock.get,
      compile: hostApiMock.compile,
      lint: hostApiMock.lint,
      applyDraft: hostApiMock.applyDraft,
      createDraft: hostApiMock.createDraft,
      listSourceSets: hostApiMock.listSourceSets,
      saveSourceSet: hostApiMock.saveSourceSet,
      deleteSourceSet: hostApiMock.deleteSourceSet,
      answerFromSourceSet: hostApiMock.answerFromSourceSet,
      createArtifactDraft: hostApiMock.createArtifactDraft,
      listDrafts: hostApiMock.listDrafts,
      getDraft: hostApiMock.getDraft,
      updateDraft: hostApiMock.updateDraft,
      reviewDraft: hostApiMock.reviewDraft,
      proposeChange: hostApiMock.proposeChange,
      listProposals: hostApiMock.listProposals,
      previewChange: hostApiMock.previewChange,
      applyReviewedChange: hostApiMock.applyReviewedChange,
      stewardReview: hostApiMock.stewardReview,
      governanceAudit: hostApiMock.governanceAudit,
      recordKnowledgeReference: hostApiMock.recordKnowledgeReference,
      getProvenance: hostApiMock.getProvenance,
      openVault: hostApiMock.openVault,
      stewardConfigGet: hostApiMock.stewardConfigGet,
      stewardConfigUpdate: hostApiMock.stewardConfigUpdate,
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
  'assistant.title': 'Knowledge Assistant',
  'assistant.subtitle': 'Read what is already in the vault.',
  'assistant.browse': 'Browse docs',
  'assistant.docs': 'Readable docs',
  'assistant.docsHint': 'Start with pages and categories.',
  'assistant.pending': 'Needs review',
  'assistant.pendingHint': 'Captured ideas waiting for a person.',
  'assistant.drafts': 'Editable drafts',
  'assistant.draftsHint': 'Drafts become durable knowledge.',
  'assistant.health': 'Health signals',
  'assistant.healthHint': 'Warnings and audit checks live in the audit center.',
  'assistant.mapTitle': 'What is inside',
  'assistant.mapHint': 'Open a topic to search the vault.',
  'actions.configure': 'Configure',
  'actions.init': 'Initialize',
  'actions.more': 'More actions',
  'actions.content': 'Content',
  'actions.maintenance': 'Maintenance',
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
  'okf.selectedConcepts': '{{count}} selected',
  'tabs.navigation': 'Knowledge primary navigation',
  'tabs.library': 'Library',
  'tabs.sources': 'Sources',
  'tabs.inbox': 'Inbox',
  'tabs.drafts': 'Draft Inbox',
  'tabs.review': 'Review',
  'tabs.governance': 'Governance',
  'library.title': 'Library',
  'sources.title': 'Sources',
  'sourceSet.title': 'Current Source Set',
  'sourceSet.savedSets': 'Saved sets',
  'sourceSet.empty': 'Add sources from search results or the current document.',
  'sourceSet.count': '{{count}} sources',
  'sourceSet.save': 'Save Source Set',
  'sourceSet.clear': 'Clear',
  'sourceSet.titlePlaceholder': 'Source Set title',
  'sourceSet.defaultTitle': 'Untitled Source Set',
  'sourceSet.addResult': 'Add to Source Set',
  'sourceSet.saved': 'Source Set saved',
  'sourceSet.answerBoundary': 'Answers prioritize selected sources; durable writes still require review.',
  'studio.title': 'Studio Assistant',
  'studio.summary': 'Summary',
  'studio.faq': 'FAQ',
  'studio.decisionMemo': 'Decision Memo',
  'studio.troubleshootingRecipe': 'Troubleshooting',
  'studio.artifactCreated': 'Studio draft created',
  'studio.question': 'Create a {{artifact}} from the current Source Set.',
  'library.typeHint': 'Filter and browse this knowledge type',
  'library.countLabel': '{{count}} pages',
  'workspace.vault': 'Vault',
  'workspace.newNote': 'New note',
  'workspace.browseTypes': 'Browse by type',
  'workspace.sourceTools': 'Source tools',
  'workspace.localVault': 'Local knowledge vault',
  'workspace.documents': 'Documents',
  'workspace.emptyDocuments': 'Search the vault or create a new Markdown note to begin.',
  'workspace.types': 'Types',
  'workspace.untitled': 'Untitled note',
  'workspace.localDraft': 'local draft',
  'workspace.characters': 'chars',
  'workspace.tagsPlaceholder': 'tags, aliases, project',
  'workspace.submitReview': 'Submit',
  'workspace.reviewReason': 'User-authored Markdown note submitted from the knowledge workspace for review.',
  'workspace.emptyPreview': 'Nothing to preview yet.',
  'workspace.modes.edit': 'Edit',
  'workspace.modes.preview': 'Preview',
  'workspace.modes.split': 'Split',
  'utility.close': 'Close panel',
  'utility.status.title': 'Vault status',
  'utility.status.description': 'Review Vault status.',
  'utility.okf.title': 'OKF validation',
  'utility.okf.description': 'Review OKF validation.',
  'utility.okf.empty': 'Validate an OKF Bundle first.',
  'utility.sources.title': 'Source tools',
  'utility.sources.description': 'Manage source tools.',
  'librarian.title': 'Knowledge Librarian',
  'librarian.roleId': 'knowledge-librarian',
  'librarian.currentDocument': 'Current document',
  'librarian.noSummary': 'Write or open a Markdown document to give the librarian context.',
  'librarian.openAssistant': 'Open librarian',
  'librarian.askSteward': 'Ask steward',
  'librarian.related': 'Related pages',
  'librarian.noRelated': 'Search results and related pages will appear here.',
  'librarian.boundaries': 'Role boundaries',
  'librarian.boundaryRead': 'Can search and answer with citations.',
  'librarian.boundaryDraft': 'Can prepare drafts and proposals, not silently write the vault.',
  'librarian.boundarySources': 'Must surface missing sources, conflicts, and stale claims.',
  'librarian.modalTitle': 'Knowledge Librarian',
  'librarian.modalSubtitle': 'Ask, organize, and review your Markdown knowledge base.',
  'librarian.writeBoundary': 'The librarian can help organize and draft knowledge.',
  'librarian.askPlaceholder': 'Ask about this vault or the current document',
  'librarian.askButton': 'Ask',
  'librarian.askHint': 'Answers use local knowledge search.',
  'librarian.checkpointSaved': 'Checkpoint saved at {{time}}',
  'librarian.noCheckpoint': 'No local checkpoint yet',
  'librarian.clearThread': 'Clear thread',
  'librarian.threadEmpty': 'Ask a question to search the vault.',
  'librarian.you': 'You',
  'librarian.answerIntro': 'I searched the vault and found {{count}} relevant source(s):',
  'librarian.answerBoundary': 'This is a local retrieval answer.',
  'librarian.answerError': 'I could not query the vault: {{error}}',
  'librarian.noAnswer': 'I could not find a matching page.',
  'librarian.emptyCitation': 'No readable excerpt was available for this source.',
  'librarian.copy': 'Copy message',
  'librarian.copied': 'Copied',
  'librarian.copyFailed': 'Could not copy message.',
  'librarian.citations': 'Citations',
  'librarian.searching': 'Searching local knowledge and reading page previews...',
  'librarian.errorTitle': 'The librarian hit a local retrieval error',
  'librarian.retry': 'Retry',
  'librarian.dismissError': 'Dismiss',
  'librarian.sections.answer': 'Answer',
  'librarian.sections.sources': 'Sources used',
  'librarian.sections.unknowns': 'Unknowns / missing sources',
  'librarian.sections.nextAction': 'Suggested next action',
  'librarian.sections.retrieval': 'Retrieval inspector',
  'librarian.retrieval.query': 'Query',
  'librarian.retrieval.corpus': 'Corpus',
  'librarian.retrieval.roleTag': 'Role tag',
  'librarian.retrieval.resultCount': 'Result count',
  'librarian.retrieval.selectedSources': 'Selected sources',
  'librarian.retrieval.selectedReason': 'Selected from local keyword retrieval',
  'librarian.unknowns.noSources': 'No matching source was found for this answer.',
  'librarian.unknowns.pageSnippetLevel': 'Grounding is page/snippet level.',
  'librarian.groundingStatus.grounded': 'Grounded',
  'librarian.groundingStatus.partial': 'Partial',
  'librarian.groundingStatus.missingSources': 'Missing sources',
  'librarian.confidence': 'Confidence',
  'librarian.candidate.draftTitlePrefix': 'Librarian answer',
  'librarian.candidate.errorExperienceTitlePrefix': 'Error experience',
  'librarian.candidate.stewardTitlePrefix': 'Steward review',
  'librarian.suggestions.summarize.label': 'Summarize current note',
  'librarian.suggestions.summarize.prompt': 'Summarize {{title}}.',
  'librarian.suggestions.related.label': 'Find related pages',
  'librarian.suggestions.related.prompt': 'Find related pages for {{title}}.',
  'librarian.suggestions.gaps.label': 'Review gaps',
  'librarian.suggestions.gaps.prompt': 'Review gaps for {{title}}.',
  'librarian.capabilities.ask.title': 'Ask the vault',
  'librarian.capabilities.ask.body': 'Answer simple questions from knowledge pages.',
  'librarian.capabilities.organize.title': 'Organize notes',
  'librarian.capabilities.organize.body': 'Suggest titles, tags, links, and frontmatter.',
  'librarian.capabilities.review.title': 'Review changes',
  'librarian.capabilities.review.body': 'Hand drafts to the steward.',
  'librarian.actions.searchRelated': 'Find related',
  'librarian.actions.saveDraft': 'Save as Draft',
  'librarian.actions.createErrorExperience': 'Create Error Experience',
  'librarian.actions.sendToSteward': 'Send to Steward',
  'librarian.actions.stewardReview': 'Steward review',
  'librarian.actions.openInbox': 'Open inbox',
  'librarian.actions.submitDraft': 'Submit draft',
  'librarian.suggestions.next.saveDraft': 'Save the grounded answer as a review draft.',
  'librarian.suggestions.next.createErrorExperience': 'Create an error-experience candidate.',
  'librarian.suggestions.next.sendToSteward': 'Ask the Knowledge Steward.',
  'librarian.suggestions.next.broadenSearch': 'Broaden the search.',
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
  'inbox.reason': 'Recommendation',
  'inbox.noReason': 'No recommendation reason recorded.',
  'inbox.boundary': 'Draft review only',
  'inbox.context': 'Capture Context',
  'inbox.statusLabel': 'Status',
  'inbox.missionId': 'Mission',
  'inbox.tick': 'Tick',
  'inbox.tickValue': 'Tick {{tick}}',
  'inbox.outcome': 'Outcome',
  'inbox.temporalityLabel': 'Temporality',
  'inbox.captureKey': 'Capture key',
  'inbox.auditDetails': 'Audit details',
  'inbox.notAvailable': 'Not available',
  'inbox.score': 'Score {{score}}',
  'inbox.percentValue': '{{percent}}%',
  'inbox.evidenceCount': '{{count}} evidence',
  'inbox.warningCount': '{{count}} warning',
  'inbox.status.pending': 'Pending',
  'inbox.status.promoted': 'Promoted',
  'inbox.status.dismissed': 'Dismissed',
  'inbox.temporality.stable': 'Stable',
  'inbox.temporality.versioned': 'Versioned',
  'inbox.temporality.ephemeral': 'Ephemeral',
  'inbox.outcomes.complete': 'Complete',
  'inbox.outcomes.sleeping': 'Sleeping',
  'inbox.outcomes.blocked': 'Blocked',
  'inbox.scoreDimensions.reusability': 'Reusability',
  'inbox.scoreDimensions.uniqueness': 'Uniqueness',
  'inbox.scoreDimensions.confidence': 'Confidence',
  'inbox.sourceKinds.task_ledger': 'Task Ledger',
  'inbox.sourceKinds.trace': 'Trace',
  'inbox.sourceKinds.chat': 'Chat',
  'inbox.sourceKinds.manual': 'Manual',
  'inbox.sourceKinds.other': 'Other',
  'inbox.groups.save': 'Recommended save',
  'inbox.groups.review': 'Needs review',
  'inbox.groups.archive-only': 'Archive only',
  'inbox.triage.title': 'Steward triage',
  'inbox.triage.confidence': '{{confidence}}%',
  'inbox.triage.duplicateOf': 'Duplicate of',
  'inbox.triage.conflictWith': 'Conflicts with',
  'inbox.triage.suggestedEdits': 'Suggested edits',
  'inbox.triage.groups.needs-decision': 'Needs decision',
  'inbox.triage.groups.ready-for-review': 'Ready for review',
  'inbox.triage.groups.possible-duplicate': 'Possible duplicate',
  'inbox.triage.groups.observe': 'Observe',
  'inbox.triage.groups.reject-low-value': 'Low value',
  'inbox.triage.actions.needs-decision': 'Needs decision',
  'inbox.triage.actions.ready-for-review': 'Ready for review',
  'inbox.triage.actions.possible-duplicate': 'Possible duplicate',
  'inbox.triage.actions.observe': 'Observe',
  'inbox.triage.actions.reject-low-value': 'Low value',
  'inbox.recommendations.save': 'Save',
  'inbox.recommendations.review': 'Review',
  'inbox.recommendations.archive-only': 'Archive only',
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
  'governance.title': 'Governance',
  'governance.openAudit': 'Audit Center',
  'governance.backToLibrary': 'Back to Library',
  'governance.readOnlyBadge': 'Agent read-only by default',
  'governance.steward': 'Knowledge Steward',
  'governance.stewardDescription': 'A role-first slot.',
  'governance.permissions': 'Permission Boundary',
  'governance.permissionsDescription': 'Chat knowledge scope only grants search/get access.',
  'governance.lastReview': 'Latest Steward Review',
  'governance.noReview': 'No steward review has run.',
  'governance.runHealthCheck': 'Run Health Check',
  'governance.runLint': 'Run Lint',
  'governance.runCompile': 'Run Compile',
  'governance.checking': 'Checking...',
  'governance.contradictions': 'Contradictions',
  'governance.stale': 'Stale Pages',
  'governance.dangling': 'Orphan Pages',
  'governance.noIssues': 'No issues detected',
  'governance.qualityMetrics.title': 'Quality Metrics',
  'governance.qualityMetrics.description': 'Compact health signals.',
  'governance.qualityMetrics.pendingAudit': 'Run health check',
  'governance.qualityMetrics.sourceAudit': 'Audit result',
  'governance.qualityMetrics.affected': '{{count}} affected item(s)',
  'governance.qualityMetrics.severity.info': 'Info',
  'governance.qualityMetrics.severity.warning': 'Warning',
  'governance.qualityMetrics.severity.error': 'Error',
  'governance.qualityMetrics.kinds.stale_cards': 'Stale cards',
  'governance.qualityMetrics.kinds.duplicate_clusters': 'Duplicate clusters',
  'governance.qualityMetrics.kinds.source_gaps': 'Source gaps',
  'governance.qualityMetrics.kinds.unreferenced_pages': 'Unreferenced pages',
  'governance.qualityMetrics.kinds.low_confidence_high_hit_cards': 'Low-confidence high-hit cards',
  'governance.qualityMetrics.kinds.high_dismissal_cards': 'High-dismissal cards',
  'governance.qualityMetrics.hints.stale_cards': 'Cards or pages with stale signals.',
  'governance.qualityMetrics.hints.duplicate_clusters': 'Potentially duplicated knowledge entries.',
  'governance.qualityMetrics.hints.source_gaps': 'Items missing usable provenance.',
  'governance.qualityMetrics.hints.unreferenced_pages': 'Pages not connected to other reviewed knowledge.',
  'governance.qualityMetrics.hints.low_confidence_high_hit_cards': 'Experience cards that fire often despite low confidence.',
  'governance.qualityMetrics.hints.high_dismissal_cards': 'Experience cards users dismiss more than they accept.',
  'governance.suggestions': 'Steward Suggestions',
  'governance.lastCheck': 'Last checked: {{time}}',
  'governance.dismissAll': 'Dismiss All',
  'governance.allClear': 'All Clear',
  'governance.allClearHint': 'No governance issues detected.',
  'governance.lintComplete': 'Lint complete',
  'governance.compileComplete': 'Compile complete',
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
  'toasts.librarianDraft': 'Librarian draft created',
  'toasts.librarianErrorExperience': 'Error experience candidate created',
  'toasts.librarianSteward': 'Steward review prepared',
  'errors.status': 'Failed to load knowledge status.',
  'errors.action': 'Knowledge action failed.',
  'errors.okfValidation': 'OKF validation failed.',
  'errors.okfImport': 'OKF import failed.',
  'errors.search': 'Search failed.',
  'errors.get': 'Failed to load knowledge page.',
  'common:actions.refresh': 'Refresh',
};

i18nTest.t = (key: string, options?: Record<string, unknown>) => {
  const template = labels[key] ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) => String(options?.[name] ?? ''));
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: i18nTest.t,
  }),
}));

describe('Knowledge page', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
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
    hostApiMock.search.mockReset();
    hostApiMock.get.mockReset();
    hostApiMock.compile.mockReset();
    hostApiMock.lint.mockReset();
    hostApiMock.applyDraft.mockReset();
    hostApiMock.createDraft.mockReset();
    hostApiMock.listSourceSets.mockReset();
    hostApiMock.saveSourceSet.mockReset();
    hostApiMock.deleteSourceSet.mockReset();
    hostApiMock.answerFromSourceSet.mockReset();
    hostApiMock.createArtifactDraft.mockReset();
    hostApiMock.listDrafts.mockReset();
    hostApiMock.getDraft.mockReset();
    hostApiMock.updateDraft.mockReset();
    hostApiMock.reviewDraft.mockReset();
    hostApiMock.proposeChange.mockReset();
    hostApiMock.listProposals.mockReset();
    hostApiMock.previewChange.mockReset();
    hostApiMock.applyReviewedChange.mockReset();
    hostApiMock.stewardReview.mockReset();
    hostApiMock.governanceAudit.mockReset();
    hostApiMock.recordKnowledgeReference.mockReset();
    hostApiMock.getProvenance.mockReset();
    hostApiMock.openVault.mockReset();
    hostApiMock.stewardConfigGet.mockReset();
    hostApiMock.stewardConfigUpdate.mockReset();
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
        sourceIds: ['task-1', 'trace:trace-loop'],
        sourceRefs: [
          { id: 'task-1', kind: 'task_ledger', label: 'Task Ledger decision' },
          { id: 'trace:trace-loop', kind: 'trace', label: 'Mission trace' },
        ],
        tags: ['governance'],
        workspaceId: null,
        agentId: null,
        createdBy: 'agent',
        warnings: ['Needs user review before writing.'],
        metadata: {
          mvpVersion: 'knowledge-interaction-mvp-1',
          recommendation: 'save',
          score: { reusability: 0.82, uniqueness: 0.5, confidence: 0.86, overall: 0.77 },
          temporality: 'stable',
          reason: 'Mission completed with reusable evidence-backed knowledge.',
          missionId: 'mission-1',
          tick: 1,
          outcome: 'complete',
          evidenceRefs: ['task-1', 'trace:trace-loop'],
          captureKey: 'mission:mission-1:tick:1:knowledge:abcdef0123456789',
          triage: {
            action: 'ready-for-review',
            confidence: 0.76,
            reason: 'Candidate has a clear type and source evidence for manual draft review.',
          },
        },
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
      }, {
        id: 'inbox-2',
        title: 'Review candidate',
        body: 'Mission produced a reusable lesson, but evidence needs a person.',
        kind: 'chat-session',
        type: 'synthesis',
        status: 'pending',
        sourceIds: ['session-1'],
        sourceRefs: [{ id: 'session-1', kind: 'chat', label: 'Mission session' }],
        tags: ['governance'],
        workspaceId: null,
        agentId: null,
        createdBy: 'agent',
        warnings: [],
        metadata: {
          mvpVersion: 'knowledge-interaction-mvp-1',
          recommendation: 'review',
          score: { reusability: 0.62, uniqueness: 0.5, confidence: 0.55, overall: 0.57 },
          temporality: 'stable',
          reason: 'Mission produced a reusable lesson, but evidence or validation needs user review.',
          missionId: 'mission-2',
          tick: 1,
          outcome: 'sleeping',
          evidenceRefs: ['session-1'],
          captureKey: 'mission:mission-2:tick:1:knowledge:abcdef0123456790',
          triage: {
            action: 'needs-decision',
            confidence: 0.78,
            reason: 'Candidate has warnings or review notes that need a human decision.',
            suggestedEdits: ['Confirm source coverage before promotion.'],
          },
        },
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
      }, {
        id: 'inbox-3',
        title: 'Failure lesson',
        body: 'Mission failed but the troubleshooting note may still be worth archiving.',
        kind: 'task-ledger',
        type: 'troubleshooting',
        status: 'pending',
        sourceIds: ['trace:failure'],
        sourceRefs: [{ id: 'trace:failure', kind: 'trace', label: 'Failure trace' }],
        tags: ['governance'],
        workspaceId: null,
        agentId: null,
        createdBy: 'agent',
        warnings: [],
        metadata: {
          mvpVersion: 'knowledge-interaction-mvp-1',
          recommendation: 'archive-only',
          score: { reusability: 0.58, uniqueness: 0.5, confidence: 0.48, overall: 0.52 },
          temporality: 'ephemeral',
          reason: 'Mission did not fully succeed; keep the lesson reviewable without formal wiki writes.',
          missionId: 'mission-3',
          tick: 1,
          outcome: 'blocked',
          evidenceRefs: ['trace:failure'],
          captureKey: 'mission:mission-3:tick:1:knowledge:abcdef0123456791',
          triage: {
            action: 'reject-low-value',
            confidence: 0.81,
            reason: 'Candidate is too sparse to promote without more context.',
            suggestedEdits: ['Add verification evidence before reviewing.'],
          },
        },
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
      }, {
        id: 'inbox-4',
        title: 'Legacy candidate',
        body: 'Older inbox item without MVP metadata should remain reviewable.',
        kind: 'manual',
        type: 'synthesis',
        status: 'pending',
        sourceIds: ['legacy-source'],
        sourceRefs: [{ id: 'legacy-source', kind: 'manual', label: 'Legacy source' }],
        tags: [],
        workspaceId: null,
        agentId: null,
        createdBy: 'agent',
        warnings: [],
        metadata: {
          triage: {
            action: 'possible-duplicate',
            confidence: 0.74,
            duplicateOf: 'inbox-1',
            reason: 'Candidate overlaps with "Task decision candidate".',
            suggestedEdits: ['Compare with the existing candidate before promotion.'],
          },
        },
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
    hostApiMock.listSourceSets.mockResolvedValue({
      success: true,
      sourceSets: [],
    });
    hostApiMock.saveSourceSet.mockResolvedValue({
      success: true,
      sourceSet: {
        id: 'ks-1',
        title: 'Decision sources',
        sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md', label: 'Decision' }],
        createdAt: '2026-07-04T00:00:00.000Z',
        updatedAt: '2026-07-04T00:00:00.000Z',
      },
    });
    hostApiMock.answerFromSourceSet.mockResolvedValue({
      success: true,
      question: 'Why use native wiki?',
      answer: 'Answer grounded in 1 selected source.\nDecision: Use native wiki.',
      sources: [{ id: 'notes/decision.md', lookup: 'notes/decision.md', title: 'Decision', excerpt: 'Use native wiki.' }],
      unknowns: ['Grounding is page/snippet level.'],
      suggestedNextActions: ['Create a Studio artifact draft when the synthesis looks useful.'],
      groundingStatus: 'grounded',
      confidence: 0.78,
      retrievalDiagnostics: {
        query: 'Why use native wiki?',
        corpus: 'wiki',
        mode: 'source-set',
        backend: 'fallback-keyword',
        resultCount: 1,
        selectedCount: 1,
        reason: 'explicit Source Set selection',
        items: [],
      },
    });
    hostApiMock.createArtifactDraft.mockResolvedValue({
      success: true,
      draft: {
        id: 'artifact-draft-1',
        title: 'Decision memo',
        body: '## Sources used\nDecision',
        type: 'decision',
        status: 'draft',
        sourceIds: ['notes/decision.md'],
        sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md', label: 'Decision' }],
        tags: ['studio-artifact', 'decision-memo'],
        workspaceId: null,
        agentId: null,
        createdBy: 'agent',
        createdAt: '2026-07-04T00:00:00.000Z',
        updatedAt: '2026-07-04T00:00:00.000Z',
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
    hostApiMock.governanceAudit.mockResolvedValue({
      success: true,
      runAt: '2026-07-04T00:00:00.000Z',
      issues: [],
      summaries: { contradictions: 0, stale: 0, dangling: 0, duplicates: 0, provenanceGaps: 0 },
      qualityMetrics: {
        staleCards: 1,
        duplicateClusters: 2,
        sourceGaps: 3,
        unreferencedPages: 4,
        lowConfidenceHighHitCards: 5,
        highDismissalCards: 6,
        metrics: [
          { kind: 'stale_cards', count: 1, severity: 'warning', affectedIds: ['stale-1'] },
          { kind: 'duplicate_clusters', count: 2, severity: 'warning', affectedIds: ['dup-1'] },
          { kind: 'source_gaps', count: 3, severity: 'warning', affectedIds: ['gap-1'] },
          { kind: 'unreferenced_pages', count: 4, severity: 'warning', affectedIds: ['orphan-1'] },
          { kind: 'low_confidence_high_hit_cards', count: 5, severity: 'warning', affectedIds: ['low-1'] },
          { kind: 'high_dismissal_cards', count: 6, severity: 'warning', affectedIds: ['dismiss-1'] },
        ],
      },
    });
    hostApiMock.openVault.mockResolvedValue({ success: true, path: 'C:/clawx/wiki' });
    hostApiMock.stewardConfigGet.mockResolvedValue({
      success: true,
      registry: { defaultRoleId: 'knowledge-steward', roles: [{ roleId: 'knowledge-steward', label: 'Knowledge Steward' }] },
      activeRole: { roleId: 'knowledge-steward', label: 'Knowledge Steward' },
    });
    hostApiMock.stewardConfigUpdate.mockResolvedValue({
      success: true,
      registry: { defaultRoleId: 'knowledge-steward', roles: [{ roleId: 'knowledge-steward', label: 'Knowledge Steward' }] },
    });
    hostApiMock.dialogOpen.mockResolvedValue({ canceled: false, filePaths: ['C:/notes/decision.md'] });
  });

  it('initializes, imports, searches, opens results, and applies drafts', async () => {
    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    await waitFor(() => expect(hostApiMock.status).toHaveBeenCalled());
    expect(screen.getByTestId('knowledge-markdown-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-assistant-overview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-metrics')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('knowledge-status-trigger'));
    await screen.findByTestId('knowledge-utility-sheet');
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));

    fireEvent.click(screen.getByText('Initialize'));
    await waitFor(() => expect(hostApiMock.init).toHaveBeenCalled());
    fireEvent.pointerDown(screen.getByTestId('knowledge-more-actions'));
    await waitFor(() => expect(screen.getByText('Import Files')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Import Files'));
    await waitFor(() => expect(hostApiMock.ingestFiles).toHaveBeenCalledWith({ paths: ['C:/notes/decision.md'] }));
    expect(screen.getByTestId('knowledge-workbench-tabs').querySelectorAll('button')).toHaveLength(4);

    fireEvent.pointerDown(screen.getByTestId('knowledge-more-actions'));
    fireEvent.click(screen.getByText('Audit Center'));
    await waitFor(() => expect(screen.getByText('Run Compile')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Run Compile'));
    await waitFor(() => expect(hostApiMock.compile).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Run Lint')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Run Lint'));
    await waitFor(() => expect(hostApiMock.lint).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('knowledge-tab-library'));
    fireEvent.change(screen.getByTestId('knowledge-search-input'), { target: { value: 'native wiki' } });
    await waitFor(() => expect(screen.getByTestId('knowledge-search-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('knowledge-search-submit'));
    await waitFor(() => expect(screen.getByTestId('knowledge-search-result')).toHaveTextContent('Decision'));

    fireEvent.click(screen.getByTestId('knowledge-search-result'));
    await screen.findByTestId('knowledge-markdown-preview');
    expect(screen.getByTestId('knowledge-markdown-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('knowledge-editor-title')).toHaveValue('Decision');
    expect(screen.getByTestId('knowledge-markdown-editor')).toHaveValue('# Decision\nUse native wiki.');
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

  it('builds a Source Set from search results and creates Studio artifact drafts without applying', async () => {
    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    expect(hostApiMock.listSourceSets).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('knowledge-source-tools'));
    await screen.findByTestId('knowledge-utility-sheet');
    expect(screen.getByTestId('knowledge-source-set-panel')).toHaveTextContent('Current Source Set');
    expect(screen.getByTestId('knowledge-source-set-panel')).toHaveTextContent('Add sources from search results');

    fireEvent.change(screen.getByTestId('knowledge-search-input'), { target: { value: 'native wiki' } });
    await waitFor(() => expect(screen.getByTestId('knowledge-search-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('knowledge-search-submit'));
    await waitFor(() => expect(screen.getByTestId('knowledge-search-result')).toHaveTextContent('Decision'));

    fireEvent.click(screen.getByTestId('knowledge-source-set-add-result'));
    await waitFor(() => expect(screen.getByTestId('knowledge-source-set-panel')).toHaveTextContent('Decision'));
    await waitFor(() => expect(screen.getByTestId('knowledge-source-set-panel')).toHaveTextContent('1 sources'));

    fireEvent.change(screen.getByTestId('knowledge-source-set-title'), { target: { value: 'Decision sources' } });
    await waitFor(() => expect(screen.getByTestId('knowledge-source-set-title')).toHaveValue('Decision sources'));
    await waitFor(() => expect(screen.getByTestId('knowledge-source-set-save')).not.toBeDisabled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(screen.getByTestId('knowledge-source-set-save'));

    await waitFor(() => expect(hostApiMock.saveSourceSet).toHaveBeenCalledWith({
      title: 'Decision sources',
      sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md', label: 'Decision' }],
    }));

    fireEvent.click(screen.getByTestId('knowledge-studio-artifact-decision-memo'));
    await waitFor(() => expect(hostApiMock.createArtifactDraft).toHaveBeenCalledWith({
      artifactType: 'decision-memo',
      title: 'Decision Memo',
      question: 'Create a Decision Memo from the current Source Set.',
      sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md', label: 'Decision' }],
      sourceSetId: 'ks-1',
    }));
    expect(hostApiMock.applyDraft).not.toHaveBeenCalled();
    expect(hostApiMock.applyReviewedChange).not.toHaveBeenCalled();
  });

  it('shows grouped inbox candidates and promotes or dismisses them without applying', async () => {
    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    await screen.findByText('Inbox');
    fireEvent.click(screen.getByTestId('knowledge-tab-inbox'));

    await screen.findByTestId('knowledge-inbox');
    expect(screen.getAllByText('Task decision candidate').length).toBeGreaterThan(0);
    expect(screen.getByTestId('knowledge-inbox-group-needs-decision')).toHaveTextContent('Needs decision');
    expect(screen.getByTestId('knowledge-inbox-group-ready-for-review')).toHaveTextContent('Ready for review');
    expect(screen.getByTestId('knowledge-inbox-group-possible-duplicate')).toHaveTextContent('Legacy candidate');
    expect(screen.getByTestId('knowledge-inbox-group-reject-low-value')).toHaveTextContent('Low value');
    expect(screen.getAllByText('Ready for review').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Possible duplicate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Save').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Review').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Archive only').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Candidate has a clear type and source evidence for manual draft review.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 evidence').length).toBeGreaterThan(0);

    const readyReviewRow = within(screen.getByTestId('knowledge-inbox-group-ready-for-review'))
      .getByText('Task decision candidate')
      .closest('button');
    expect(readyReviewRow).not.toBeNull();
    fireEvent.click(readyReviewRow!);
    await waitFor(() => expect(screen.getByTestId('knowledge-inbox-triage-detail')).toHaveTextContent('Ready for review'));
    expect(screen.getByText('Needs user review before writing.')).toBeInTheDocument();
    expect(screen.getAllByText('Score 77').length).toBeGreaterThan(0);
    expect(screen.getByTestId('knowledge-inbox-boundary')).toHaveTextContent('Draft review only');
    expect(screen.getByTestId('knowledge-inbox-recommendation')).toHaveTextContent('Steward triage');
    expect(screen.getByTestId('knowledge-inbox-recommendation')).toHaveTextContent('76%');
    expect(screen.getByTestId('knowledge-inbox-scores')).toHaveTextContent('Reusability');
    expect(screen.getByTestId('knowledge-inbox-scores')).toHaveTextContent('82%');
    expect(screen.getByTestId('knowledge-inbox-scores')).toHaveTextContent('Uniqueness');
    expect(screen.getByTestId('knowledge-inbox-scores')).toHaveTextContent('50%');
    expect(screen.getByTestId('knowledge-inbox-scores')).toHaveTextContent('Confidence');
    expect(screen.getByTestId('knowledge-inbox-scores')).toHaveTextContent('86%');
    expect(screen.getByTestId('knowledge-inbox-context')).toHaveTextContent('Pending');
    expect(screen.getByTestId('knowledge-inbox-context')).toHaveTextContent('mission-1');
    expect(screen.getByTestId('knowledge-inbox-context')).toHaveTextContent('Tick 1');
    expect(screen.getByTestId('knowledge-inbox-context')).toHaveTextContent('Complete');
    expect(screen.getByTestId('knowledge-inbox-context')).toHaveTextContent('Stable');
    expect(screen.getByTestId('knowledge-inbox-audit')).toHaveTextContent('Audit details');
    expect(screen.getByTestId('knowledge-inbox-context')).toHaveTextContent('mission:mission-1:tick:1:knowledge:abcdef0123456789');
    expect(screen.getByTestId('knowledge-inbox-sources')).toHaveTextContent('Task Ledger');
    expect(screen.getByTestId('knowledge-inbox-sources')).toHaveTextContent('Trace');
    expect(screen.getAllByTestId('knowledge-inbox-source')).toHaveLength(2);

    await waitFor(() => expect(screen.getByTestId('knowledge-inbox-dismiss')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('knowledge-inbox-dismiss'));
    await waitFor(() => expect(hostApiMock.dismissInboxItem).toHaveBeenCalledWith({ id: 'inbox-1' }));
    await waitFor(() => expect(screen.getByTestId('knowledge-inbox-promote')).not.toBeDisabled());

    fireEvent.click(screen.getByTestId('knowledge-inbox-promote'));
    await waitFor(() => expect(hostApiMock.promoteInboxItemToDraft).toHaveBeenCalledWith({ id: 'inbox-2' }));
    expect(hostApiMock.applyDraft).not.toHaveBeenCalled();
    expect(hostApiMock.applyReviewedChange).not.toHaveBeenCalled();
  });

  it('shows Governance quality metrics after a health check', async () => {
    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    fireEvent.pointerDown(screen.getByTestId('knowledge-more-actions'));
    fireEvent.click(screen.getByText('Audit Center'));
    await screen.findByTestId('knowledge-governance');

    expect(screen.getByTestId('knowledge-quality-metrics')).toHaveTextContent('Quality Metrics');
    expect(screen.getByTestId('knowledge-quality-metrics')).toHaveTextContent('Run health check');

    fireEvent.click(screen.getByTestId('knowledge-governance-run'));
    await waitFor(() => expect(hostApiMock.governanceAudit).toHaveBeenCalled());

    const metrics = screen.getByTestId('knowledge-quality-metrics');
    expect(metrics).toHaveTextContent('Audit result');
    expect(within(screen.getByTestId('knowledge-quality-metric-stale_cards')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('knowledge-quality-metric-source_gaps')).getByText('3')).toBeInTheDocument();
    expect(screen.getByTestId('knowledge-quality-metric-low_confidence_high_hit_cards')).toHaveTextContent('Low-confidence high-hit cards');
    expect(screen.getByTestId('knowledge-quality-metric-high_dismissal_cards')).toHaveTextContent('6');
  });

  it('answers knowledge librarian questions with local citations and a checkpoint', async () => {
    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    fireEvent.click(screen.getByTestId('knowledge-librarian-open'));
    await screen.findByTestId('knowledge-librarian-modal');
    expect(screen.getByTestId('knowledge-librarian-composer')).toBeInTheDocument();
    expect(screen.getByTestId('knowledge-librarian-suggestions')).toHaveTextContent('Summarize current note');

    fireEvent.change(screen.getByTestId('knowledge-librarian-question'), { target: { value: 'Why use native wiki?' } });
    await waitFor(() => expect(screen.getByTestId('knowledge-librarian-ask')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('knowledge-librarian-ask'));

    await waitFor(() => expect(hostApiMock.search).toHaveBeenCalledWith({
      query: 'Why use native wiki?',
      maxResults: 4,
      corpus: 'wiki',
      roleTag: 'knowledge-librarian',
    }));
    await waitFor(() => expect(hostApiMock.get).toHaveBeenCalledWith({ lookup: 'notes/decision.md', lineCount: 80, corpus: 'wiki' }));
    await screen.findByText(/I searched the vault/);
    expect(screen.getByTestId('knowledge-librarian-message-assistant')).toHaveTextContent('Decision');
    expect(screen.getByTestId('knowledge-librarian-grounded-answer')).toHaveTextContent('Answer');
    expect(screen.getByTestId('knowledge-librarian-sources-section')).toHaveTextContent('Decision');
    expect(screen.getByTestId('knowledge-librarian-unknowns-section')).toHaveTextContent('Grounding is page/snippet level.');
    expect(screen.getByTestId('knowledge-librarian-next-action-section')).toHaveTextContent('Save the grounded answer');
    expect(screen.getByTestId('knowledge-librarian-retrieval-inspector')).toHaveTextContent('Why use native wiki?');
    expect(screen.getByTestId('knowledge-librarian-citations')).toHaveTextContent('notes/decision.md');

    fireEvent.click(screen.getByTestId('knowledge-librarian-save-draft'));
    await waitFor(() => expect(hostApiMock.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Librarian answer: Why use native wiki?'),
      metadata: expect.objectContaining({
        knowledgeKind: 'librarian-grounded-answer',
        groundingStatus: 'grounded',
      }),
    })));

    fireEvent.click(screen.getByTestId('knowledge-librarian-create-error-experience'));
    await waitFor(() => expect(hostApiMock.createInboxItem).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'manual',
      type: 'troubleshooting',
      metadata: expect.objectContaining({
        knowledgeKind: 'error-experience',
        errorExperience: expect.objectContaining({
          schemaVersion: 1,
          title: expect.stringContaining('Error experience: Why use native wiki?'),
        }),
      }),
    })));

    fireEvent.click(screen.getByTestId('knowledge-librarian-send-steward'));
    await waitFor(() => expect(hostApiMock.stewardReview).toHaveBeenCalledWith({ draftId: 'draft-1' }));
    expect(hostApiMock.applyDraft).not.toHaveBeenCalled();
    expect(hostApiMock.applyReviewedChange).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('clawx.knowledge.librarian.checkpoint.v1')).toContain('Why use native wiki?');
  });

  it('shows a recoverable librarian retrieval error with retry', async () => {
    hostApiMock.search
      .mockResolvedValueOnce({ success: false, error: 'Index unavailable' })
      .mockResolvedValueOnce({
        success: true,
        results: [{ pagePath: 'notes/decision.md', title: 'Decision', snippet: 'Use native wiki.' }],
      });

    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    fireEvent.click(screen.getByTestId('knowledge-librarian-open'));
    await screen.findByTestId('knowledge-librarian-modal');

    fireEvent.change(screen.getByTestId('knowledge-librarian-question'), { target: { value: 'Why use native wiki?' } });
    await waitFor(() => expect(screen.getByTestId('knowledge-librarian-ask')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('knowledge-librarian-ask'));

    await screen.findByTestId('knowledge-librarian-error');
    expect(screen.getByTestId('knowledge-librarian-error')).toHaveTextContent('Index unavailable');

    fireEvent.click(screen.getByTestId('knowledge-librarian-retry'));

    await waitFor(() => expect(hostApiMock.search).toHaveBeenCalledTimes(2));
    await screen.findByText(/I searched the vault/);
    expect(screen.queryByTestId('knowledge-librarian-error')).not.toBeInTheDocument();
  });

  it('validates an OKF folder and imports only user-selected concepts', async () => {
    hostApiMock.dialogOpen.mockResolvedValueOnce({ canceled: false, filePaths: ['C:/okf'] });
    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    fireEvent.pointerDown(screen.getByTestId('knowledge-more-actions'));
    fireEvent.click(screen.getByText('Validate OKF Bundle'));

    await waitFor(() => expect(hostApiMock.validateOkfBundle).toHaveBeenCalledWith({ path: 'C:/okf' }));
    await screen.findByTestId('knowledge-okf-panel');
    expect(screen.getByText('OKF validation')).toBeInTheDocument();
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
