import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkModeSummaryPanel } from '@/components/chat/WorkModeSummaryPanel';

const translations: Record<string, string> = {
  'composer.workMode.docsData': 'Docs/Data',
  'composer.knowledgeScope.all': 'All',
  'composer.permissionMode.readOnly': 'Read only',
  'composer.permissionMode.acceptEdits': 'Accept edits',
  'workModePanel.summary.docsData': 'Docs/Data mode focuses on document, spreadsheet, PDF, and report artifacts.',
  'workModePanel.artifactTypes.markdown': 'Markdown',
  'workModePanel.artifactTypes.docx': 'DOCX',
  'workModePanel.artifactTypes.xlsx': 'XLSX',
  'workModePanel.artifactTypes.csv': 'CSV',
  'workModePanel.artifactTypes.pptx': 'PPTX',
  'workModePanel.artifactTypes.pdf': 'PDF',
  'workModePanel.capability.ready': 'Ready',
  'workModes.kits.reports': 'Reports',
  'workModes.kits.sheets': 'Sheets',
  'workModes.kits.slides': 'Slides',
  'workModes.kits.pdf': 'PDF',
  'composer.workMode.build': 'Build',
  'composer.knowledgeScope.none': 'None',
  'workModePanel.summary.build': 'Build mode focuses on implementation, verification, and concise change summaries.',
  'workModePanel.intensityMode_full': 'Full context',
  'workModePanel.intensityMode_minimal': 'Minimal context',
  'workModePanel.intensityMode_none': 'No context',
  'workModePanel.intensity': 'Intensity',
  'workModePanel.tokenSavings': 'Saves ~{{tokens}} tokens',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'workModePanel.knowledge') return `Knowledge: ${String(options?.scope ?? '')}`;
      if (key === 'workModePanel.artifacts') return `Artifacts: ${String(options?.types ?? '')}`;
      if (key === 'workModePanel.providerStatus') {
        return `Providers: ${String(options?.ready ?? '')} ready`;
      }
      if (key === 'workModePanel.kitStatus') {
        return `${String(options?.kit ?? '')}: ${String(options?.status ?? '')}`;
      }
      if (key === 'workModePanel.permissionMismatch') {
        return `Current permission is ${String(options?.current ?? '')}; recommended for this mode is ${String(options?.recommended ?? '')}.`;
      }
      if (key === 'workModePanel.tokenSavings') {
        return `Saves ${String(options?.tokens ?? '')} tokens`;
      }
      return translations[key] ?? key;
    },
  }),
}));

describe('WorkModeSummaryPanel', () => {
  it('shows docs/data kits, artifact types, and permission mismatch', () => {
    render(
      <WorkModeSummaryPanel
        workMode="docsData"
        knowledgeScope="all"
        permissionMode="readOnly"
        skills={[
          { id: 'docx', enabled: true },
          { id: 'xlsx', enabled: true },
          { id: 'pptx', enabled: true },
          { id: 'pdf', enabled: true },
        ]}
      />,
    );

    const panel = screen.getByTestId('work-mode-summary-panel');
    expect(panel).toHaveTextContent('Docs/Data');
    expect(panel).toHaveTextContent('Artifacts: Markdown, DOCX, PDF, XLSX, CSV, PPTX');
    expect(panel).toHaveTextContent('Reports: Ready');
    expect(panel).toHaveTextContent('Sheets: Ready');
    expect(panel).toHaveTextContent('Slides: Ready');
    expect(panel).toHaveTextContent('PDF: Ready');
    expect(screen.getByText('Knowledge: All')).toBeInTheDocument();
    expect(screen.getByText('Current permission is Read only; recommended for this mode is Accept edits.')).toBeInTheDocument();
  });

  it('keeps compact chat rail output focused on current context', () => {
    render(
      <WorkModeSummaryPanel
        workMode="docsData"
        knowledgeScope="all"
        permissionMode="acceptEdits"
        compact
        providerCapabilities={[
          {
            kit: 'reports',
            capability: 'document.write',
            providerIds: ['office-document-js'],
            statuses: ['ready'],
            sourceKinds: ['builtInLibrary'],
          },
        ]}
        skills={[
          { id: 'docx', enabled: true },
          { id: 'xlsx', enabled: true },
          { id: 'pptx', enabled: true },
          { id: 'pdf', enabled: true },
        ]}
      />,
    );

    const panel = screen.getByTestId('work-mode-summary-panel');
    expect(panel).toHaveTextContent('Docs/Data');
    expect(panel).toHaveTextContent('Knowledge: All');
    expect(panel).toHaveTextContent('Docs/Data mode focuses on document, spreadsheet, PDF, and report artifacts.');
    expect(panel).not.toHaveTextContent('Providers:');
    expect(panel).not.toHaveTextContent('Artifacts:');
    expect(panel).not.toHaveTextContent('Reports: Ready');
    expect(panel).not.toHaveTextContent('Saves');
  });

  it('cycles prompt mode when intensity toggle is clicked', () => {
    const onPromptModeChange = vi.fn();
    const { rerender } = render(
      <WorkModeSummaryPanel
        workMode="docsData"
        knowledgeScope="all"
        permissionMode="acceptEdits"
        compact
        onPromptModeChange={onPromptModeChange}
        skills={[
          { id: 'docx', enabled: true },
          { id: 'xlsx', enabled: true },
          { id: 'pptx', enabled: true },
          { id: 'pdf', enabled: true },
        ]}
      />,
    );

    const toggle = screen.getByTestId('work-mode-intensity-toggle');
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveTextContent('Minimal context');

    fireEvent.click(toggle);
    expect(onPromptModeChange).toHaveBeenLastCalledWith('none');

    rerender(
      <WorkModeSummaryPanel
        workMode="docsData"
        promptMode="none"
        knowledgeScope="all"
        permissionMode="acceptEdits"
        compact
        onPromptModeChange={onPromptModeChange}
        skills={[
          { id: 'docx', enabled: true },
          { id: 'xlsx', enabled: true },
          { id: 'pptx', enabled: true },
          { id: 'pdf', enabled: true },
        ]}
      />,
    );
    fireEvent.click(toggle);
    expect(onPromptModeChange).toHaveBeenLastCalledWith('full');

    rerender(
      <WorkModeSummaryPanel
        workMode="docsData"
        promptMode="full"
        knowledgeScope="all"
        permissionMode="acceptEdits"
        compact
        onPromptModeChange={onPromptModeChange}
        skills={[
          { id: 'docx', enabled: true },
          { id: 'xlsx', enabled: true },
          { id: 'pptx', enabled: true },
          { id: 'pdf', enabled: true },
        ]}
      />,
    );
    fireEvent.click(toggle);
    expect(onPromptModeChange).toHaveBeenLastCalledWith('minimal');
  });

  it('renders a non-interactive badge when no toggle handler is provided', () => {
    render(
      <WorkModeSummaryPanel
        workMode="build"
        knowledgeScope="none"
        skills={[]}
      />,
    );

    expect(screen.getByTestId('work-mode-intensity-badge')).toHaveTextContent('Full context');
    expect(screen.queryByTestId('work-mode-intensity-toggle')).not.toBeInTheDocument();
  });

  it('applies rounded-full class to the intensity toggle button', () => {
    render(
      <WorkModeSummaryPanel
        workMode="docsData"
        knowledgeScope="all"
        onPromptModeChange={vi.fn()}
        skills={[{ id: 'docx', enabled: true }]}
      />,
    );

    const toggle = screen.getByTestId('work-mode-intensity-toggle');
    expect(toggle.className).toContain('rounded-full');
  });

  it('applies rounded-full class to the non-interactive badge too', () => {
    render(
      <WorkModeSummaryPanel
        workMode="build"
        knowledgeScope="none"
        skills={[]}
      />,
    );

    const badge = screen.getByTestId('work-mode-intensity-badge');
    expect(badge.className).toContain('rounded-full');
  });

  it('renders the single-letter marker (M/F/N) alongside the label', () => {
    const { rerender } = render(
      <WorkModeSummaryPanel
        workMode="docsData"
        promptMode="minimal"
        knowledgeScope="all"
        onPromptModeChange={vi.fn()}
        skills={[{ id: 'docx', enabled: true }]}
      />,
    );

    let toggle = screen.getByTestId('work-mode-intensity-toggle');
    expect(toggle).toHaveTextContent('M');
    expect(toggle).toHaveTextContent('Minimal context');

    rerender(
      <WorkModeSummaryPanel
        workMode="docsData"
        promptMode="full"
        knowledgeScope="all"
        onPromptModeChange={vi.fn()}
        skills={[{ id: 'docx', enabled: true }]}
      />,
    );
    toggle = screen.getByTestId('work-mode-intensity-toggle');
    expect(toggle).toHaveTextContent('F');

    rerender(
      <WorkModeSummaryPanel
        workMode="docsData"
        promptMode="none"
        knowledgeScope="all"
        onPromptModeChange={vi.fn()}
        skills={[{ id: 'docx', enabled: true }]}
      />,
    );
    toggle = screen.getByTestId('work-mode-intensity-toggle');
    expect(toggle).toHaveTextContent('N');
  });

  it('shows token savings text only when promptMode is not full', () => {
    const { rerender } = render(
      <WorkModeSummaryPanel
        workMode="docsData"
        promptMode="minimal"
        knowledgeScope="all"
        onPromptModeChange={vi.fn()}
        skills={[{ id: 'docx', enabled: true }]}
      />,
    );

    let panel = screen.getByTestId('work-mode-summary-panel');
    expect(panel).toHaveTextContent('Saves ~1.5k-2.5k tokens');

    rerender(
      <WorkModeSummaryPanel
        workMode="docsData"
        promptMode="full"
        knowledgeScope="all"
        onPromptModeChange={vi.fn()}
        skills={[{ id: 'docx', enabled: true }]}
      />,
    );
    panel = screen.getByTestId('work-mode-summary-panel');
    expect(panel).not.toHaveTextContent('Saves ~1.5k-2.5k tokens');
    expect(panel).not.toHaveTextContent('Saves ~3k-5k tokens');
  });

  it('does not call onPromptModeChange when handler is absent (badge is not a button)', () => {
    render(
      <WorkModeSummaryPanel
        workMode="build"
        knowledgeScope="none"
        skills={[]}
      />,
    );

    const badge = screen.getByTestId('work-mode-intensity-badge');
    expect(badge.tagName).not.toBe('BUTTON');
  });

  it('uses the workMode default promptMode when promptMode prop is omitted', () => {
    // build mode defaults to 'full' in WORK_MODE_PROMPT_MAP
    render(
      <WorkModeSummaryPanel
        workMode="build"
        knowledgeScope="none"
        onPromptModeChange={vi.fn()}
        skills={[]}
      />,
    );

    const toggle = screen.getByTestId('work-mode-intensity-toggle');
    expect(toggle).toHaveTextContent('Full context');
    expect(toggle).toHaveTextContent('F');
  });
});
