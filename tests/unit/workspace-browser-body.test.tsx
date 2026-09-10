import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceBrowserBody } from '@/components/file-preview/WorkspaceBrowserBody';
import type { WorkspaceTreeNode } from '@/lib/workspace-tree';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string }) => (
      typeof options === 'string' ? options : options?.defaultValue ?? _key
    ),
  }),
}));

const readTextFile = vi.fn();
const statFile = vi.fn();
const startOfficeWatch = vi.fn();
const stopOfficeWatch = vi.fn();
const installOfficeCli = vi.fn();
const syncOfficeSkills = vi.fn();

vi.mock('@/lib/file-preview-client', () => ({
  readTextFile: (...args: unknown[]) => readTextFile(...args),
  statFile: (...args: unknown[]) => statFile(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    shell: {
      openPath: vi.fn(),
      showItemInFolder: vi.fn(),
    },
    officeTools: {
      startWatch: (...args: unknown[]) => startOfficeWatch(...args),
      stopWatch: (...args: unknown[]) => stopOfficeWatch(...args),
      install: (...args: unknown[]) => installOfficeCli(...args),
      syncSkills: (...args: unknown[]) => syncOfficeSkills(...args),
    },
  },
}));

const htmlNode: WorkspaceTreeNode = {
  name: 'dashboard.html',
  relPath: 'dashboard.html',
  absPath: '/workspace/dashboard.html',
  isDir: false,
  size: 10_700,
  ext: '.html',
  mimeType: 'text/html',
  contentType: 'document',
};

const docxNode: WorkspaceTreeNode = {
  name: 'report.docx',
  relPath: 'report.docx',
  absPath: '/workspace/report.docx',
  isDir: false,
  size: 24_000,
  ext: '.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  contentType: 'document',
};

vi.mock('@/lib/workspace-tree', () => ({
  loadWorkspaceTree: vi.fn(async () => ({
    root: {
      name: 'workspace',
      relPath: '',
      absPath: '/workspace',
      isDir: true,
      children: [htmlNode, docxNode],
    },
    truncated: false,
  })),
  collectInitialExpanded: vi.fn(() => new Set([''])),
  findNode: vi.fn((root: WorkspaceTreeNode, relPath: string) => {
    if (relPath === 'dashboard.html') return htmlNode;
    if (relPath === 'report.docx') return docxNode;
    return null;
  }),
}));

describe('WorkspaceBrowserBody', () => {
  beforeEach(() => {
    readTextFile.mockReset();
    statFile.mockReset();
    startOfficeWatch.mockReset();
    stopOfficeWatch.mockReset();
    installOfficeCli.mockReset();
    syncOfficeSkills.mockReset();
    statFile.mockResolvedValue({ ok: true, size: 24_000 });
    startOfficeWatch.mockResolvedValue({ port: 24000, cap: 'cap-1' });
    installOfficeCli.mockResolvedValue({ installed: true, version: 'officecli 1.2.3', path: '/bin/officecli', runtimeError: null });
    syncOfficeSkills.mockResolvedValue({ synced: 9, errors: [] });
  });

  it('renders html files as sandboxed HTML preview instead of raw source', async () => {
    readTextFile.mockResolvedValueOnce({
      ok: true,
      content: '<!doctype html><html><body><h1 id="title">Dashboard</h1></body></html>',
      size: 72,
      readOnly: true,
    });

    render(
      <WorkspaceBrowserBody
        agent={{ id: 'main', name: 'Main Agent', workspace: '/workspace' } as never}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('dashboard.html')).toBeVisible();
    });

    expect(screen.getByTestId('ai-file-tree')).toBeInTheDocument();

    fireEvent.click(screen.getByText('dashboard.html'));

    const frame = await screen.findByTestId('html-preview-frame');
    expect(frame).toBeVisible();
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-forms allow-presentation',
    );
    expect(screen.queryByText('<!doctype html>')).not.toBeInTheDocument();
  });

  it('renders Office documents through OfficeCLI watch preview', async () => {
    render(
      <WorkspaceBrowserBody
        agent={{ id: 'main', name: 'Main Agent', workspace: '/workspace' } as never}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('report.docx')).toBeVisible();
    });

    fireEvent.click(screen.getByText('report.docx'));

    const frame = await screen.findByTestId('office-preview-frame');
    expect(startOfficeWatch).toHaveBeenCalledWith({ rootPath: '/workspace', path: 'report.docx' });
    expect(frame).toHaveAttribute('src', 'http://127.0.0.1:24000/');
  });

  it('offers install and retries when OfficeCLI watch reports a wrapped NOT_INSTALLED error', async () => {
    startOfficeWatch
      .mockRejectedValueOnce(new Error('Host API officeTools.startWatch failed: NOT_INSTALLED: officecli is not installed'))
      .mockResolvedValueOnce({ port: 24001, cap: 'cap-2' });

    render(
      <WorkspaceBrowserBody
        agent={{ id: 'main', name: 'Main Agent', workspace: '/workspace' } as never}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('report.docx')).toBeVisible();
    });

    fireEvent.click(screen.getByText('report.docx'));

    fireEvent.click(await screen.findByRole('button', { name: 'Install OfficeCLI' }));

    const frame = await screen.findByTestId('office-preview-frame');
    expect(installOfficeCli).toHaveBeenCalledTimes(1);
    expect(syncOfficeSkills).toHaveBeenCalledTimes(1);
    expect(startOfficeWatch).toHaveBeenCalledTimes(2);
    expect(frame).toHaveAttribute('src', 'http://127.0.0.1:24001/');
  });
});
