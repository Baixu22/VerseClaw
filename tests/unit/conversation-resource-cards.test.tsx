import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantMarkdown } from '@/components/assistant-render/AssistantMarkdown';
import { ConversationImage } from '@/components/assistant-render/resources/ConversationImage';
import { ConversationMediaCard } from '@/components/assistant-render/resources/ConversationMediaCard';
import { ConversationResourceList, WebsiteLinkCard } from '@/components/assistant-render/resources/ResourceCards';
import { AgentInteractionRenderer, parseToolUiContent } from '@/components/tool-ui/agent-interactions';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat';

const { readBinaryFile, statFile, thumbnails, openExternal, showItemInFolder, openPath, openWorkspacePanel } = vi.hoisted(() => ({
  readBinaryFile: vi.fn(),
  statFile: vi.fn(),
  thumbnails: vi.fn(),
  openExternal: vi.fn(async () => undefined),
  showItemInFolder: vi.fn(async () => undefined),
  openPath: vi.fn(async () => ''),
  openWorkspacePanel: vi.fn(),
}));

vi.mock('@/lib/file-preview-client', () => ({
  readBinaryFile: (...args: unknown[]) => readBinaryFile(...args),
  statFile: (...args: unknown[]) => statFile(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    media: { thumbnails: (...args: unknown[]) => thumbnails(...args) },
    shell: { openExternal, showItemInFolder, openPath },
    dialog: { message: vi.fn(async () => ({ response: 1 })) },
  },
}));

vi.mock('@/stores/artifact-panel', () => ({
  openWorkspacePanel: (...args: unknown[]) => openWorkspacePanel(...args),
}));

function renderInApp(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

function audioFile(overrides: Partial<AttachedFileMeta> = {}): AttachedFileMeta {
  return {
    fileName: 'speech.wav',
    mimeType: 'audio/wav',
    fileSize: 0,
    preview: null,
    filePath: '/w/out/speech.wav',
    source: 'tool-media',
    ...overrides,
  };
}

function setPlaybackError(element: HTMLElement, code: number) {
  Object.defineProperty(element, 'error', { configurable: true, value: { code } });
  fireEvent.error(element);
}

beforeEach(() => {
  readBinaryFile.mockReset();
  statFile.mockReset();
  thumbnails.mockReset();
  openExternal.mockClear();
  showItemInFolder.mockClear();
  openWorkspacePanel.mockClear();
  let counter = 0;
  createObjectURL.mockReset();
  createObjectURL.mockImplementation(() => {
    counter += 1;
    return `blob:mock-${counter}`;
  });
  revokeObjectURL.mockReset();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
  statFile.mockResolvedValue({ ok: true, isFile: true, size: 2048, mtime: Date.now() });
  readBinaryFile.mockResolvedValue({ ok: true, data: new Uint8Array([1, 2, 3]), size: 2048 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConversationMediaCard', () => {
  it('reads the file once, not on every render', async () => {
    const { rerender } = renderInApp(<ConversationMediaCard file={audioFile()} />);
    await screen.findByTestId('chat-resource-player');
    rerender(<TooltipProvider><ConversationMediaCard file={audioFile()} /></TooltipProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

    expect(readBinaryFile).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('plays audio through a native player fed by the Main file boundary', async () => {
    renderInApp(<ConversationMediaCard file={audioFile()} />);

    const card = screen.getByTestId('chat-resource-audio');
    expect(card).toHaveAttribute('data-status', 'loading');
    expect(card).toHaveTextContent('speech.wav');

    await waitFor(() => expect(card).toHaveAttribute('data-status', 'ready'));
    const player = screen.getByTestId('chat-resource-player') as HTMLAudioElement;
    expect(player.tagName).toBe('AUDIO');
    expect(player).toHaveAttribute('controls');
    expect(player.getAttribute('src')).toBe('blob:mock-1');
    expect(readBinaryFile).toHaveBeenCalledWith('/w/out/speech.wav', { maxBytes: 50 * 1024 * 1024 });
    expect(card).toHaveTextContent('audio/wav');
    expect(card).toHaveTextContent('2.0 KB');
  });

  it('renders video with native controls', async () => {
    renderInApp(<ConversationMediaCard file={audioFile({ fileName: 'c.webm', mimeType: 'video/webm', filePath: '/w/c.webm' })} />);

    await waitFor(() => expect(screen.getByTestId('chat-resource-video')).toHaveAttribute('data-status', 'ready'));
    const player = screen.getByTestId('chat-resource-player');
    expect(player.tagName).toBe('VIDEO');
    expect(player).toHaveAttribute('controls');
  });

  it('shows the duration once metadata loads', async () => {
    renderInApp(<ConversationMediaCard file={audioFile()} />);
    const player = await screen.findByTestId('chat-resource-player');
    Object.defineProperty(player, 'duration', { configurable: true, value: 75 });
    fireEvent.loadedMetadata(player);
    expect(screen.getByTestId('chat-resource-audio')).toHaveTextContent('1:15');
  });

  it('revokes the Blob URL on unmount', async () => {
    const { unmount } = renderInApp(<ConversationMediaCard file={audioFile()} />);
    await screen.findByTestId('chat-resource-player');
    expect(revokeObjectURL).not.toHaveBeenCalled();

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });

  it('revokes the old Blob URL when the source changes', async () => {
    const { rerender } = renderInApp(<ConversationMediaCard file={audioFile()} />);
    await screen.findByTestId('chat-resource-player');

    rerender(<TooltipProvider><ConversationMediaCard file={audioFile({ filePath: '/w/out/other.wav' })} /></TooltipProvider>);

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1'));
    await waitFor(() => expect(screen.getByTestId('chat-resource-player').getAttribute('src')).toBe('blob:mock-2'));
  });

  it('does not create a Blob URL after unmounting mid-read', async () => {
    let finishRead: (value: unknown) => void = () => {};
    readBinaryFile.mockReturnValue(new Promise((resolve) => { finishRead = resolve; }));
    const { unmount } = renderInApp(<ConversationMediaCard file={audioFile()} />);
    await waitFor(() => expect(readBinaryFile).toHaveBeenCalled());

    unmount();
    await act(async () => finishRead({ ok: true, data: new Uint8Array([1]) }));

    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('reports a missing file and retries on request', async () => {
    statFile.mockResolvedValueOnce({ ok: false, error: 'notFound' });
    renderInApp(<ConversationMediaCard file={audioFile()} />);

    const card = screen.getByTestId('chat-resource-audio');
    await waitFor(() => expect(card).toHaveAttribute('data-status', 'notFound'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-resource-player')).toBeNull();

    fireEvent.click(screen.getByTestId('chat-resource-retry'));

    await waitFor(() => expect(card).toHaveAttribute('data-status', 'ready'));
  });

  it('reports a location outside the read sandbox', async () => {
    statFile.mockResolvedValue({ ok: false, error: 'outsideSandbox' });
    renderInApp(<ConversationMediaCard file={audioFile()} />);
    await waitFor(() => expect(screen.getByTestId('chat-resource-audio')).toHaveAttribute('data-status', 'outsideSandbox'));
    expect(readBinaryFile).not.toHaveBeenCalled();
  });

  it('refuses to read past the cap and keeps a way to open the file', async () => {
    statFile.mockResolvedValue({ ok: true, isFile: true, size: 60 * 1024 * 1024 });
    renderInApp(<ConversationMediaCard file={audioFile()} />);

    await waitFor(() => expect(screen.getByTestId('chat-resource-audio')).toHaveAttribute('data-status', 'tooLarge'));
    expect(readBinaryFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('resources.media.revealInFolder'));
    expect(showItemInFolder).toHaveBeenCalledWith('/w/out/speech.wav');
  });

  it('asks before reading a large file into memory', async () => {
    statFile.mockResolvedValue({ ok: true, isFile: true, size: 20 * 1024 * 1024 });
    renderInApp(<ConversationMediaCard file={audioFile()} />);

    await screen.findByTestId('chat-resource-load');
    expect(readBinaryFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('chat-resource-load'));

    await screen.findByTestId('chat-resource-player');
    expect(readBinaryFile).toHaveBeenCalledTimes(1);
  });

  it('skips the size gate when explicitly opened, as the side panel does', async () => {
    statFile.mockResolvedValue({ ok: true, isFile: true, size: 20 * 1024 * 1024 });
    renderInApp(<ConversationMediaCard file={audioFile()} autoLoad />);
    await screen.findByTestId('chat-resource-player');
  });

  it('falls back when the browser cannot play the format', async () => {
    renderInApp(<ConversationMediaCard file={audioFile()} />);
    const player = await screen.findByTestId('chat-resource-player');

    setPlaybackError(player, 4);

    const card = screen.getByTestId('chat-resource-audio');
    expect(card).toHaveAttribute('data-status', 'unsupported');
    expect(screen.queryByTestId('chat-resource-player')).toBeNull();
    expect(screen.getByLabelText('resources.media.openWithSystem')).toBeInTheDocument();
  });

  it('labels other playback failures separately', async () => {
    renderInApp(<ConversationMediaCard file={audioFile()} />);
    setPlaybackError(await screen.findByTestId('chat-resource-player'), 2);
    expect(screen.getByTestId('chat-resource-audio')).toHaveAttribute('data-status', 'failed');
  });

  it('resolves Gateway media through Main and never fetches it', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const gatewayUrl = '/api/chat/media/outgoing/s/id/full';
    thumbnails.mockResolvedValue({ [gatewayUrl]: { preview: null, fileSize: 9, resolvedPath: '/h/.openclaw/media/a.mp3' } });

    renderInApp(<ConversationMediaCard file={audioFile({ filePath: undefined, gatewayUrl })} />);

    await screen.findByTestId('chat-resource-player');
    expect(thumbnails).toHaveBeenCalledWith({ paths: [{ gatewayUrl, mimeType: 'audio/wav' }] });
    expect(readBinaryFile).toHaveBeenCalledWith('/h/.openclaw/media/a.mp3', expect.anything());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-resource-player').getAttribute('src')).not.toContain('/api/');
  });

  it('reports Gateway media whose record is gone', async () => {
    const gatewayUrl = '/api/chat/media/outgoing/s/gone/full';
    thumbnails.mockResolvedValue({ [gatewayUrl]: { preview: null, fileSize: 0 } });
    renderInApp(<ConversationMediaCard file={audioFile({ filePath: undefined, gatewayUrl })} />);
    await waitFor(() => expect(screen.getByTestId('chat-resource-audio')).toHaveAttribute('data-status', 'notFound'));
  });

  it('plays inline data without any host call', async () => {
    renderInApp(<ConversationMediaCard file={audioFile({ filePath: undefined, preview: 'data:audio/wav;base64,AAAA' })} />);
    expect(screen.getByTestId('chat-resource-player').getAttribute('src')).toBe('data:audio/wav;base64,AAAA');
    expect(statFile).not.toHaveBeenCalled();
  });

  it('never loads remote media and offers to open it instead', () => {
    renderInApp(<ConversationMediaCard file={audioFile({
      filePath: undefined,
      mimeType: 'video/mp4',
      fileName: 'clip.mp4',
      remoteUrl: 'https://cdn.example/clip.mp4',
    })} />);

    const card = screen.getByTestId('chat-resource-video');
    expect(card).toHaveAttribute('data-status', 'remote');
    expect(screen.queryByTestId('chat-resource-player')).toBeNull();
    expect(statFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('chat-resource-open-external'));
    expect(openExternal).toHaveBeenCalledWith('https://cdn.example/clip.mp4');
  });

  it('explains media with nothing left to read', () => {
    renderInApp(<ConversationMediaCard file={audioFile({ filePath: undefined, previewStatus: 'unavailable' })} />);
    expect(screen.getByTestId('chat-resource-audio')).toHaveAttribute('data-status', 'unavailable');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('opens the resolved file in the side panel', async () => {
    const onOpen = vi.fn();
    renderInApp(<ConversationMediaCard file={audioFile()} onOpen={onOpen} />);
    await screen.findByTestId('chat-resource-player');
    fireEvent.click(screen.getByTestId('chat-resource-open-panel'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/w/out/speech.wav' }));
  });

  it('marks voice notes', async () => {
    renderInApp(<ConversationMediaCard file={audioFile({ isVoiceNote: true })} />);
    await screen.findByTestId('chat-resource-player');
    expect(screen.getByTestId('chat-resource-audio')).toHaveTextContent('resources.media.voiceNote');
  });
});

describe('ConversationImage', () => {
  it('never loads a remote image and shows alt, location and an open path', () => {
    const { container } = renderInApp(<ConversationImage url="https://x.example/p.png?token=abc" alt="Chart" />);

    expect(container.querySelector('img')).toBeNull();
    const placeholder = screen.getByTestId('chat-resource-image');
    expect(placeholder).toHaveAttribute('data-status', 'remote');
    expect(placeholder).toHaveTextContent('Chart');
    expect(placeholder).toHaveTextContent('x.example');
    expect(placeholder).not.toHaveTextContent('abc');

    fireEvent.click(screen.getByTestId('chat-resource-open-external'));
    expect(openExternal).toHaveBeenCalledWith('https://x.example/p.png?token=abc');
  });

  it('resolves Gateway images through Main thumbnails', async () => {
    const url = '/api/chat/media/outgoing/s/id/full';
    thumbnails.mockResolvedValue({ [url]: { preview: 'data:image/png;base64,AAAA', fileSize: 3 } });

    renderInApp(<ConversationImage url={url} alt="Gen" />);
    expect(screen.getByTestId('chat-resource-image')).toHaveAttribute('data-status', 'loading');

    const image = await screen.findByAltText('Gen');
    expect(image).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(thumbnails).toHaveBeenCalledWith({ paths: [{ gatewayUrl: url, mimeType: 'image/png' }] });
  });

  it('asks Main once, not on every render', async () => {
    const url = '/api/chat/media/outgoing/s/once/full';
    thumbnails.mockResolvedValue({ [url]: { preview: 'data:image/png;base64,AAAA', fileSize: 3 } });

    const { rerender } = renderInApp(<ConversationImage url={url} alt="Once" />);
    await screen.findByAltText('Once');
    rerender(<TooltipProvider><ConversationImage url={url} alt="Once" /></TooltipProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

    expect(thumbnails).toHaveBeenCalledTimes(1);
  });

  it('resolves local paths through Main thumbnails', async () => {
    thumbnails.mockResolvedValue({ '/w/a.jpg': { preview: 'data:image/jpeg;base64,AAAA', fileSize: 3 } });
    renderInApp(<ConversationImage url="/w/a.jpg" alt="Local" />);
    expect((await screen.findByAltText('Local')).getAttribute('src')).toContain('data:image/jpeg');
    expect(thumbnails).toHaveBeenCalledWith({ paths: [{ filePath: '/w/a.jpg', mimeType: 'image/jpeg' }] });
  });

  it('shows the failure state when Main has no preview', async () => {
    const url = '/api/chat/media/outgoing/s/gone/full';
    thumbnails.mockResolvedValue({ [url]: { preview: null, fileSize: 0 } });
    renderInApp(<ConversationImage url={url} alt="Gone" />);
    await waitFor(() => expect(screen.getByTestId('chat-resource-image')).toHaveAttribute('data-status', 'unavailable'));
    expect(screen.getByTestId('chat-resource-image')).toHaveTextContent('Gone');
  });

  it('shows the failure state when Main itself fails', async () => {
    thumbnails.mockRejectedValue(new Error('ipc down'));
    renderInApp(<ConversationImage url="/w/a.png" />);
    await waitFor(() => expect(screen.getByTestId('chat-resource-image')).toHaveAttribute('data-status', 'unavailable'));
  });

  it('replaces an image that fails to decode', () => {
    renderInApp(<ConversationImage url="data:image/png;base64,AAAA" alt="Broken" />);
    fireEvent.error(screen.getByAltText('Broken'));
    expect(screen.getByTestId('chat-resource-image')).toHaveAttribute('data-status', 'unavailable');
  });

  it.each(['relative/a.png', 'data:text/html,<script>', 'javascript:alert(1)'])('refuses to use %s as a source', (url) => {
    const { container } = renderInApp(<ConversationImage url={url} alt="Bad" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('chat-resource-image')).toHaveAttribute('data-status', 'unavailable');
  });

  it('labels an image history did not keep', () => {
    renderInApp(<ConversationImage omitted bytes={2048} />);
    const placeholder = screen.getByTestId('chat-resource-image');
    expect(placeholder).toHaveAttribute('data-status', 'omitted');
  });

  it('opens the shared lightbox', () => {
    renderInApp(<ConversationImage url="data:image/png;base64,AAAA" alt="Inline" />);
    fireEvent.click(screen.getByTestId('chat-resource-image'));
    expect(screen.getByTestId('chat-image-lightbox')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('chat-image-lightbox')).toBeNull();
  });
});

describe('image gallery', () => {
  function renderGallery(images: Array<Record<string, unknown>>) {
    const parsed = parseToolUiContent(['```tool-ui', JSON.stringify({ type: 'image-gallery', images }), '```'].join('\n'));
    expect(parsed.interactions[0]?.type).toBe('image-gallery');
    return renderInApp(<AgentInteractionRenderer interactions={parsed.interactions} />);
  }

  it('resolves each tile through the shared resolver', async () => {
    const gateway = '/api/chat/media/outgoing/s/id/full';
    thumbnails.mockResolvedValue({ [gateway]: { preview: 'data:image/png;base64,GGGG', fileSize: 1 } });

    const { container } = renderGallery([
      { url: 'data:image/png;base64,AAAA', alt: 'inline', caption: 'First' },
      { url: gateway, alt: 'gateway' },
      { url: 'https://x.example/remote.png', alt: 'remote' },
      { url: 'broken.png', alt: 'broken' },
    ]);

    await screen.findByAltText('gateway');
    expect(screen.getByAltText('inline')).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    const statuses = screen.getAllByTestId('chat-resource-image').map((node) => node.getAttribute('data-status'));
    expect(statuses).toEqual(['ready', 'ready', 'remote', 'unavailable']);
    for (const image of Array.from(container.querySelectorAll('img'))) {
      expect(image.getAttribute('src')).toMatch(/^data:image\//);
    }
  });

  it('opens a gallery image in the shared lightbox', () => {
    renderGallery([{ url: 'data:image/png;base64,AAAA', alt: 'inline' }]);
    fireEvent.click(screen.getByTestId('chat-resource-image'));
    expect(screen.getByTestId('chat-image-lightbox')).toBeInTheDocument();
  });
});

describe('website links', () => {
  it('shows title, host and URL, and opens externally', () => {
    renderInApp(<WebsiteLinkCard url="https://www.example.com/docs?page=2" title="The docs" />);
    const card = screen.getByTestId('chat-resource-website-link');
    expect(card).toHaveTextContent('The docs');
    expect(card).toHaveTextContent('example.com');
    expect(card).toHaveTextContent('https://www.example.com/docs?page=2');

    fireEvent.click(screen.getByTestId('chat-resource-open-external'));
    expect(openExternal).toHaveBeenCalledWith('https://www.example.com/docs?page=2');
  });

  it('never embeds the site', () => {
    const { container } = renderInApp(<WebsiteLinkCard url="https://example.com" allowSidePreview />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('webview')).toBeNull();
  });

  it('only offers the side panel where it exists, and it loads nothing itself', () => {
    const { unmount } = renderInApp(<WebsiteLinkCard url="https://example.com/a" />);
    expect(screen.queryByTestId('chat-resource-open-browser-panel')).toBeNull();
    unmount();

    renderInApp(<WebsiteLinkCard url="https://example.com/a" allowSidePreview />);
    fireEvent.click(screen.getByTestId('chat-resource-open-browser-panel'));
    expect(openWorkspacePanel).toHaveBeenCalledWith({ panel: 'browser', view: 'live', url: 'https://example.com/a' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('masks secrets in what it shows', () => {
    renderInApp(<WebsiteLinkCard url="https://example.com/a?access_token=SECRET" />);
    expect(screen.getByTestId('chat-resource-website-link')).not.toHaveTextContent('SECRET');
  });

  it('keeps a disallowed scheme as plain words', () => {
    renderInApp(<WebsiteLinkCard url="javascript:alert(1)" title="Click" />);
    expect(screen.queryByTestId('chat-resource-website-link')).toBeNull();
    expect(screen.getByText('Click')).toBeInTheDocument();
  });

  it('becomes a card when a paragraph is only a link', () => {
    renderInApp(<AssistantMarkdown text="[Read the guide](https://example.com/guide)" isStreaming={false} />);
    expect(screen.getByTestId('chat-resource-website-link')).toHaveTextContent('Read the guide');
  });

  it('becomes a card for a bare URL, titled by its host', () => {
    renderInApp(<AssistantMarkdown text="https://example.com/guide" isStreaming={false} />);
    expect(screen.getByTestId('chat-resource-website-link')).toHaveTextContent('example.com');
  });

  it('stays an inline link inside a sentence', () => {
    renderInApp(<AssistantMarkdown text="See [the guide](https://example.com/guide) first." isStreaming={false} />);
    expect(screen.queryByTestId('chat-resource-website-link')).toBeNull();
    expect(screen.getByRole('link', { name: 'the guide' })).toHaveAttribute('href', 'https://example.com/guide');
  });

  it('keeps GitHub links on their existing card', () => {
    renderInApp(<AssistantMarkdown text="https://github.com/acme/repo" isStreaming={false} />);
    expect(screen.queryByTestId('chat-resource-website-link')).toBeNull();
    expect(screen.getByRole('button', { name: /acme\/repo/ })).toBeInTheDocument();
  });

  it('does not flip layout while streaming', () => {
    renderInApp(<AssistantMarkdown text="https://example.com/guide" isStreaming />);
    expect(screen.queryByTestId('chat-resource-website-link')).toBeNull();
  });

  it('keeps web-search sources a separate surface from link cards', () => {
    const parsed = parseToolUiContent(['```tool-ui', JSON.stringify({
      type: 'web-search',
      query: 'q',
      results: [{ title: 'A source', url: 'https://example.com/source' }],
    }), '```'].join('\n'));
    renderInApp(<AgentInteractionRenderer interactions={parsed.interactions} />);
    expect(screen.getByTestId('chat-tool-ui-web-search')).toHaveTextContent('A source');
    expect(screen.queryByTestId('chat-resource-website-link')).toBeNull();
  });

  it('accepts the Tool UI link-preview type', () => {
    const parsed = parseToolUiContent(['```tool-ui', JSON.stringify({
      type: 'link-preview',
      url: 'https://example.com/x',
      title: 'Preview',
      description: 'Desc',
    }), '```'].join('\n'));
    renderInApp(<AgentInteractionRenderer interactions={parsed.interactions} />);
    expect(screen.getByTestId('chat-resource-website-link')).toHaveTextContent('Desc');
  });
});

describe('Markdown images', () => {
  it('shows a placeholder instead of silently dropping a remote image', () => {
    const { container } = renderInApp(<AssistantMarkdown text={'Before\n\n![Beacon](https://x.example/p.png)\n\nAfter'} isStreaming={false} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('chat-resource-image')).toHaveTextContent('Beacon');
  });

  it('covers reference-style images too', () => {
    renderInApp(<AssistantMarkdown text={'![Ref][1]\n\n[1]: https://x.example/p.png'} isStreaming={false} />);
    expect(screen.getByTestId('chat-resource-image')).toHaveAttribute('data-status', 'remote');
  });

  it('nests no block element inside the paragraph', () => {
    const { container } = renderInApp(<AssistantMarkdown text="![Beacon](https://x.example/p.png)" isStreaming={false} />);
    expect(container.querySelector('p div')).toBeNull();
  });
});

describe('unknown resources', () => {
  it('shows descriptive fields with copy and safe open, and no raw payload', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));

    renderInApp(<ConversationResourceList resources={[{
      kind: 'unknown',
      key: 'k',
      type: 'sankey',
      title: 'Flows',
      description: 'Traffic',
      displayUrl: 'https://x.example/f?token=***',
      openUrl: 'https://x.example/f?token=abc',
    }]} />);

    const card = screen.getByTestId('chat-resource-unknown');
    expect(card).toHaveAttribute('data-resource-type', 'sankey');
    expect(card).toHaveTextContent('Flows');
    expect(card).toHaveTextContent('Traffic');
    expect(card).not.toHaveTextContent('abc');

    fireEvent.click(screen.getByTestId('chat-resource-open-external'));
    expect(openExternal).toHaveBeenCalledWith('https://x.example/f?token=abc');

    fireEvent.click(screen.getByTestId('chat-resource-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String((writeText.mock.calls as unknown as string[][])[0]?.[0])).not.toContain('abc');
  });

  it('opens a local path only through the in-app panel', () => {
    const onOpenFilePath = vi.fn();
    renderInApp(<ConversationResourceList
      onOpenFilePath={onOpenFilePath}
      resources={[{ kind: 'unknown', key: 'k', type: 'report', path: '/w/report.bin' }]}
    />);
    fireEvent.click(screen.getByLabelText('resources.media.openInPanel'));
    expect(onOpenFilePath).toHaveBeenCalledWith('/w/report.bin');
    expect(openPath).not.toHaveBeenCalled();
  });
});

describe('ChatMessage resource visibility', () => {
  const textBlock = { type: 'text', text: 'Here is the result.' };

  it('plays a block-only reply', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [{ type: 'attachment', attachment: { url: '/w/a.wav', kind: 'audio', label: 'a.wav', mimeType: 'audio/wav' } }],
    };
    renderInApp(<ChatMessage message={message} suppressProcessAttachments suppressToolCards suppressAssistantText />);
    await screen.findByTestId('chat-resource-player');
  });

  it('keeps a declared artifact visible when the turn is folded, even with reply text', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [textBlock],
      _attachedFiles: [audioFile()],
    };
    renderInApp(<ChatMessage message={message} suppressProcessAttachments suppressToolCards />);
    await screen.findByTestId('chat-resource-player');
  });

  it('reports a declared artifact that has gone missing, instead of dropping it', async () => {
    statFile.mockResolvedValue({ ok: false, error: 'notFound' });
    const message: RawMessage = { role: 'assistant', content: [], _attachedFiles: [audioFile()] };
    renderInApp(<ChatMessage message={message} suppressProcessAttachments />);
    await waitFor(() => expect(screen.getByTestId('chat-resource-audio')).toHaveAttribute('data-status', 'notFound'));
  });

  it('shows a file an external tool wrote during this turn', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [textBlock],
      _attachedFiles: [audioFile({ source: 'tool-result', filePath: '/w/out/new.wav', producedAfter: 1000 })],
    };
    statFile.mockResolvedValue({ ok: true, isFile: true, size: 10, mtime: 5000 });

    renderInApp(<ChatMessage message={message} suppressProcessAttachments suppressToolCards />);

    await screen.findByTestId('chat-resource-player');
  });

  it('hides an old file the turn merely listed', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [textBlock],
      _attachedFiles: [audioFile({ source: 'tool-result', filePath: '/w/old.wav', producedAfter: 100_000 })],
    };
    statFile.mockResolvedValue({ ok: true, isFile: true, size: 10, mtime: 5000 });

    renderInApp(<ChatMessage message={message} suppressProcessAttachments suppressToolCards />);

    await waitFor(() => expect(statFile).toHaveBeenCalled());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(screen.queryByTestId('chat-resource-audio')).toBeNull();
    expect(screen.getByText('Here is the result.')).toBeInTheDocument();
  });

  it('leaves no orphan avatar when the only candidate fails validation', async () => {
    statFile.mockResolvedValue({ ok: false, error: 'notFound' });
    const message: RawMessage = {
      role: 'assistant',
      content: [],
      _attachedFiles: [audioFile({ source: 'tool-result', filePath: '/w/gone.wav', producedAfter: 1 })],
    };
    const { container } = renderInApp(<ChatMessage message={message} suppressProcessAttachments suppressToolCards />);

    await waitFor(() => expect(statFile).toHaveBeenCalled());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(screen.queryByTestId('chat-assistant-avatar')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('resolves an artifact the reply names by relative path', async () => {
    statFile.mockImplementation(async (path: string) => (path === '/proj/out/speech.wav'
      ? { ok: true, isFile: true, size: 10, mtime: 1 }
      : { ok: false, error: 'notFound' }));
    const message: RawMessage = { role: 'assistant', content: 'Audio saved to `out/speech.wav`, not out/missing.wav.' };

    renderInApp(<ChatMessage message={message} workspaceRoot="/proj" />);

    await screen.findByTestId('chat-resource-player');
    expect(screen.getAllByTestId('chat-resource-audio')).toHaveLength(1);
  });

  it('resolves a relative image itself, because the store never saw it', async () => {
    statFile.mockResolvedValue({ ok: true, isFile: true, size: 10, mtime: 1 });
    thumbnails.mockResolvedValue({ '/proj/out/plot.png': { preview: 'data:image/png;base64,AAAA', fileSize: 10 } });
    const message: RawMessage = { role: 'assistant', content: 'Saved `out/plot.png`.' };

    renderInApp(<ChatMessage message={message} workspaceRoot="/proj" />);

    expect((await screen.findByAltText('plot.png')).getAttribute('src')).toContain('data:image/png');
  });

  it('keeps relative mentions as text without a workspace', async () => {
    const message: RawMessage = { role: 'assistant', content: 'Audio saved to out/speech.wav.' };
    renderInApp(<ChatMessage message={message} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(statFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chat-resource-audio')).toBeNull();
  });

  it('bounds the number of inline players in one message', async () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [],
      _attachedFiles: Array.from({ length: 8 }, (_, index) => audioFile({
        fileName: `t${index}.wav`,
        filePath: `/w/t${index}.wav`,
        fileSize: 10,
      })),
    };
    renderInApp(<ChatMessage message={message} />);

    await waitFor(() => expect(screen.getAllByTestId('chat-resource-audio')).toHaveLength(6));
    expect(screen.getAllByTestId('assistant-attachment-card')).toHaveLength(2);
  });

  it('renders a user upload as a player too', async () => {
    const message: RawMessage = {
      role: 'user',
      content: 'Transcribe this',
      _attachedFiles: [audioFile({ source: 'user-upload', fileSize: 10 })],
    };
    renderInApp(<ChatMessage message={message} />);
    await screen.findByTestId('chat-resource-player');
  });

  it('keeps document cards for non-media attachments', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: 'Done',
      _attachedFiles: [{ fileName: 'r.pdf', mimeType: 'application/pdf', fileSize: 10, preview: null, filePath: '/w/r.pdf' }],
    };
    renderInApp(<ChatMessage message={message} />);
    expect(screen.getByTestId('assistant-attachment-card')).toHaveTextContent('r.pdf');
  });

  it('renders unknown blocks on an otherwise empty message', () => {
    const message: RawMessage = { role: 'assistant', content: [{ type: 'canvas', title: 'Board' } as never] };
    renderInApp(<ChatMessage message={message} />);
    expect(screen.getByTestId('chat-resource-unknown')).toHaveTextContent('Board');
    expect(screen.getByTestId('chat-assistant-avatar')).toBeInTheDocument();
  });
});
