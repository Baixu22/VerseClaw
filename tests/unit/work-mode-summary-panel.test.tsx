import { render, screen } from '@testing-library/react';
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
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'workModePanel.knowledge') return `Knowledge: ${String(options?.scope ?? '')}`;
      if (key === 'workModePanel.artifacts') return `Artifacts: ${String(options?.types ?? '')}`;
      if (key === 'workModePanel.kitStatus') {
        return `${String(options?.kit ?? '')}: ${String(options?.status ?? '')}`;
      }
      if (key === 'workModePanel.permissionMismatch') {
        return `Current permission is ${String(options?.current ?? '')}; recommended for this mode is ${String(options?.recommended ?? '')}.`;
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
});
