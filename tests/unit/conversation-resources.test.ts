import { describe, expect, it, vi } from 'vitest';
import {
  attachToolMediaToTurns,
  classifyResourceUrl,
  dedupeConversationMedia,
  extractRelativeArtifactPaths,
  extractToolResultMedia,
  isProducedThisTurn,
  mediaKindOf,
  projectContentBlockResources,
  resolveWorkspaceRelativeFiles,
  sanitizeResourceUrl,
  toUnknownResource,
} from '@/pages/Chat/conversation-resources';
import { projectMessageRender } from '@/pages/Chat/message-render-projection';
import { extractImages, extractText, isUnresolvableImageUrl } from '@/pages/Chat/message-utils';
import type { RawMessage } from '@/stores/chat';

function assistant(content: unknown, extra: Partial<RawMessage> = {}): RawMessage {
  return { role: 'assistant', content, ...extra };
}

const flags = { isUser: false, suppressAssistantText: false, suppressToolCards: false };

describe('classifyResourceUrl', () => {
  it.each([
    ['data:audio/wav;base64,AAAA', 'data'],
    ['/api/chat/media/outgoing/s/id/full', 'gateway'],
    ['https://cdn.example/clip.mp4', 'remote'],
    ['/home/me/clip.mp4', 'path'],
    ['~/clip.mp4', 'path'],
    ['C:\\media\\clip.mp4', 'path'],
    ['C:/media/clip.mp4', 'path'],
  ])('classifies %s as %s', (input, kind) => {
    expect(classifyResourceUrl(input)?.kind).toBe(kind);
  });

  it('decodes file URLs to a local path', () => {
    expect(classifyResourceUrl('file:///C:/my%20media/a.mp3')).toEqual({ kind: 'path', path: 'C:/my media/a.mp3' });
  });

  it.each(['//evil.example/x.png', '\\\\server\\share\\a.mp3', 'relative/a.mp3', '', 42, null])(
    'refuses %s',
    (input) => {
      expect(classifyResourceUrl(input)).toBeNull();
    },
  );
});

describe('content block projection', () => {
  it('reads the audio block the Gateway really emits (chat-webchat-media.ts)', () => {
    const { attachments } = projectContentBlockResources(assistant([
      { type: 'text', text: 'Audio reply' },
      {
        type: 'attachment',
        attachment: {
          url: '/home/me/.openclaw/media/voice.opus',
          kind: 'audio',
          label: 'voice.opus',
          mimeType: 'audio/opus',
          isVoiceNote: true,
        },
      },
    ]), { isUser: false });

    expect(attachments).toEqual([expect.objectContaining({
      fileName: 'voice.opus',
      mimeType: 'audio/opus',
      filePath: '/home/me/.openclaw/media/voice.opus',
      isVoiceNote: true,
      source: 'gateway-media',
    })]);
  });

  it('turns a base64 audio block into a playable data URL', () => {
    const { attachments } = projectContentBlockResources(assistant([
      { type: 'audio', source: { type: 'base64', media_type: 'audio/wav', data: 'AAAA' }, label: 'Take 1' },
    ]), { isUser: false });

    expect(attachments[0]).toMatchObject({ fileName: 'Take 1', preview: 'data:audio/wav;base64,AAAA' });
  });

  it('keeps audio visible after the history projection drops its bytes', () => {
    const { attachments } = projectContentBlockResources(assistant([
      { type: 'audio', source: { type: 'base64', media_type: 'audio/mpeg', omitted: true, bytes: 2048 } },
    ]), { isUser: false });

    expect(attachments[0]).toMatchObject({ mimeType: 'audio/mpeg', fileSize: 2048, previewStatus: 'unavailable' });
    expect(attachments[0]?.filePath).toBeUndefined();
  });

  it('reports an image whose bytes were dropped from history', () => {
    const { resources } = projectContentBlockResources(assistant([
      { type: 'image', omitted: true, bytes: 4096, mimeType: 'image/png' },
    ]), { isUser: false });

    expect(resources).toEqual([expect.objectContaining({ kind: 'image', omitted: true, bytes: 4096 })]);
  });

  it('routes attachment kinds to their owners', () => {
    const { attachments, resources } = projectContentBlockResources(assistant([
      { type: 'attachment', attachment: { url: '/x/clip.mp4', kind: 'video', label: 'clip.mp4' } },
      { type: 'attachment', attachment: { url: '/x/report.pdf', kind: 'document', label: 'report.pdf' } },
      { type: 'attachment', attachment: { url: 'https://docs.example/a', kind: 'document', label: 'Docs' } },
      { type: 'attachment', attachment: { url: '/x/a.png', kind: 'image', label: 'a.png' } },
    ]), { isUser: false });

    expect(attachments.map((file) => [file.fileName, file.mimeType])).toEqual([
      ['clip.mp4', 'video/mp4'],
      ['report.pdf', 'application/pdf'],
    ]);
    expect(resources.map((resource) => resource.kind)).toEqual(['website-link', 'image']);
  });

  it('sends remote and local image blocks to the resolver', () => {
    const { resources } = projectContentBlockResources(assistant([
      { type: 'image', source: { type: 'url', url: 'https://cdn.example/a.png', media_type: 'image/png' } },
      { type: 'image', url: '/tmp/b.png', alt: 'b' },
      { type: 'input_image', image_url: 'https://cdn.example/c.png' },
    ]), { isUser: false });

    expect(resources.map((resource) => (resource.kind === 'image' ? resource.url : null))).toEqual([
      'https://cdn.example/a.png',
      '/tmp/b.png',
      'https://cdn.example/c.png',
    ]);
  });

  it('leaves images extractImages already owns alone', () => {
    const { resources } = projectContentBlockResources(assistant([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
    ]), { isUser: false });

    expect(resources).toEqual([]);
  });

  it('gives unrecognized assistant blocks a card, but ignores process plumbing', () => {
    const { resources } = projectContentBlockResources(assistant([
      { type: 'canvas', preview: { title: 'Dashboard', url: 'https://app.example/d' } },
      { type: 'thinking', thinking: 'secret reasoning' },
      { type: 'redacted_thinking', data: 'opaque' },
      { type: 'server_tool_use', id: '1', name: 'search', input: {} },
      { type: 'tool_use', id: '2', name: 'x', input: {} },
      { type: 'output_text', text: 'plain' },
      { type: 'mystery_blob', opaque: 'no identity' },
    ]), { isUser: false });

    expect(resources).toEqual([expect.objectContaining({ kind: 'unknown', type: 'canvas', title: 'Dashboard' })]);
  });

  it('does not invent unknown resources from user content', () => {
    const { resources } = projectContentBlockResources(
      { role: 'user', content: [{ type: 'canvas', title: 'x' }] },
      { isUser: true },
    );
    expect(resources).toEqual([]);
  });
});

describe('unknown resources stay safe', () => {
  it('masks credentials and sensitive query values', () => {
    const { displayUrl } = sanitizeResourceUrl('https://user:pw@files.example/a?token=abc&page=2&X-Signature=zzz');
    expect(displayUrl).not.toContain('abc');
    expect(displayUrl).not.toContain('pw');
    expect(displayUrl).not.toContain('zzz');
    expect(displayUrl).toContain('page=2');
  });

  it('does not offer to open a URL the navigation policy rejects', () => {
    expect(sanitizeResourceUrl('https://user:pw@files.example/a').openUrl).toBeUndefined();
    expect(sanitizeResourceUrl('https://files.example/a').openUrl).toBe('https://files.example/a');
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'not a url'])('yields nothing to show for %s', (input) => {
    expect(sanitizeResourceUrl(input)).toEqual({});
  });

  it('keeps descriptive fields only and logs no values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resource = toUnknownResource({
      type: 'secret-widget',
      title: 'Quarterly',
      description: 'Numbers',
      url: 'https://x.example/?api_key=SECRET',
      apiToken: 'SECRET',
      rows: [{ a: 1 }],
    }, { key: 'k' });

    expect(resource).toMatchObject({ type: 'secret-widget', title: 'Quarterly', description: 'Numbers' });
    expect(JSON.stringify(resource)).not.toContain('apiToken');
    expect(resource?.displayUrl).not.toContain('SECRET');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    warn.mockRestore();
  });

  it('strips markup from the displayed type', () => {
    expect(toUnknownResource({ type: '<img src=x>' }, { key: 'k' })?.type).toBe('imgsrcx');
  });
});

describe('tool result media', () => {
  it('reads the attachments video_generate and music_generate declare', () => {
    const files = extractToolResultMedia({
      details: {
        attachments: [
          { type: 'video', path: '/x/clip.mp4', mimeType: 'video/mp4', name: 'clip-1' },
          { type: 'video', url: 'https://cdn.example/remote.mp4', mimeType: 'video/mp4', name: 'remote.mp4' },
          { type: 'image', path: '/x/poster.png', mimeType: 'image/png' },
        ],
        media: { mediaUrls: ['/x/clip.mp4'] },
      },
    });

    expect(files).toEqual([
      expect.objectContaining({ fileName: 'clip-1', filePath: '/x/clip.mp4', source: 'tool-media' }),
      expect.objectContaining({ fileName: 'remote.mp4', remoteUrl: 'https://cdn.example/remote.mp4', source: 'tool-media' }),
    ]);
  });

  it('reads the tts tool result and its voice note flag', () => {
    const files = extractToolResultMedia({
      content: [{ type: 'text', text: '(spoken) hello' }],
      details: { audioPath: '/x/tts.opus', media: { mediaUrl: '/x/tts.opus', audioAsVoice: true } },
    });

    expect(files).toEqual([expect.objectContaining({ filePath: '/x/tts.opus', isVoiceNote: true, source: 'tool-media' })]);
  });

  it('treats MEDIA tags and media-attached markers as declared', () => {
    const files = extractToolResultMedia({
      content: 'Done\nMEDIA:/x/out one.mp3\n[media attached: /x/b.wav (audio/wav) | /x/b.wav]',
    });

    expect(files.map((file) => [file.filePath, file.source])).toEqual([
      ['/x/out one.mp3', 'tool-media'],
      ['/x/b.wav', 'tool-media'],
    ]);
  });

  it('finds what an external tool printed, marked with the start of its turn', () => {
    const files = extractToolResultMedia({
      content: 'synth: wrote /srv/app/out/speech.wav (2.1s)',
      producedAfter: 1000,
    });

    expect(files).toEqual([expect.objectContaining({
      filePath: '/srv/app/out/speech.wav',
      mimeType: 'audio/wav',
      source: 'tool-result',
      producedAfter: 1000,
    })]);
  });

  it('finds paths in structured output, including escaped Windows ones', () => {
    const files = extractToolResultMedia({
      content: '{"output":"C:\\\\app\\\\out\\\\a.wav"}',
      details: { result: { nested: ['D:/app/out/b.mp4'] } },
    });

    expect(files.map((file) => file.filePath)).toEqual(['C:\\app\\out\\a.wav', 'D:/app/out/b.mp4']);
  });

  it('declared media wins over the same path found in output', () => {
    const files = extractToolResultMedia({
      content: 'saved /x/a.mp3',
      details: { attachments: [{ type: 'audio', path: '/x/a.mp3', mimeType: 'audio/mpeg' }] },
      producedAfter: 1000,
    });

    expect(files).toHaveLength(1);
    expect(files[0]?.source).toBe('tool-media');
  });

  it('ignores URLs and images in tool output', () => {
    const files = extractToolResultMedia({
      content: 'see https://cdn.example/a.mp3 and /x/shot.png and page.html',
    });
    expect(files).toEqual([]);
  });
});

describe('isProducedThisTurn', () => {
  it('separates files this turn wrote from files it merely listed', () => {
    expect(isProducedThisTurn({ producedAfter: 100_000 }, 100_500)).toBe(true);
    expect(isProducedThisTurn({ producedAfter: 100_000 }, 40_000)).toBe(false);
  });

  it('allows for coarse file times', () => {
    expect(isProducedThisTurn({ producedAfter: 100_000 }, 99_000)).toBe(true);
  });

  it('does not hide a file when either time is unknown', () => {
    expect(isProducedThisTurn({}, 40_000)).toBe(true);
    expect(isProducedThisTurn({ producedAfter: 100_000 }, undefined)).toBe(true);
  });
});

describe('relative artifact paths in a reply', () => {
  it('finds workspace-relative binary artifacts', () => {
    const files = extractRelativeArtifactPaths('Generated `out/speech.wav` and ./render/clip.mp4, plus report.pdf.');
    expect(files.map((file) => [file.filePath, file.mimeType, file.source])).toEqual([
      ['out/speech.wav', 'audio/wav', 'message-ref'],
      ['render/clip.mp4', 'video/mp4', 'message-ref'],
      ['report.pdf', 'application/pdf', 'message-ref'],
    ]);
  });

  it('skips prose documents, URLs, absolute paths and fenced commands', () => {
    const files = extractRelativeArtifactPaths([
      'See README.md and https://cdn.example/a.mp3 and /abs/b.mp3',
      '```bash',
      'ffmpeg -i input.mp3 output.wav',
      '```',
    ].join('\n'));
    expect(files).toEqual([]);
  });

  it('joins candidates to the workspace root and drops them without one', () => {
    const files = extractRelativeArtifactPaths('out/a.wav');
    expect(resolveWorkspaceRelativeFiles(files, 'C:\\proj\\')[0]?.filePath).toBe('C:\\proj\\out\\a.wav');
    expect(resolveWorkspaceRelativeFiles(files, '/proj')[0]?.filePath).toBe('/proj/out/a.wav');
    expect(resolveWorkspaceRelativeFiles(files, null)).toEqual([]);
  });

  it('leaves a UNC attachment alone rather than treating it as relative', () => {
    const unc = { fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 1, preview: null, filePath: '\\\\server\\share\\a.pdf' };
    expect(resolveWorkspaceRelativeFiles([unc], null)).toEqual([unc]);
    expect(resolveWorkspaceRelativeFiles([unc], '/proj')).toEqual([unc]);
  });

  it('merges a relative mention with an attachment of the same file', () => {
    const absolute = { fileName: 'a.wav', mimeType: 'audio/wav', fileSize: 1, preview: null, filePath: '/proj/out/a.wav' };
    const [relative] = extractRelativeArtifactPaths('out/a.wav');
    expect(resolveWorkspaceRelativeFiles([absolute, relative!], '/proj')).toEqual([absolute]);
  });
});

describe('one owner per media resource', () => {
  const media = (filePath: string, source: 'tool-media' | 'tool-result' | 'message-ref') => ({
    fileName: filePath.split('/').pop()!,
    mimeType: 'video/mp4',
    fileSize: 0,
    preview: null,
    filePath,
    source,
  });
  const user: RawMessage = { role: 'user', content: 'go' };

  it('keeps the latest message when several in a turn carry the file', () => {
    const result = dedupeConversationMedia([
      user,
      assistant([{ type: 'text', text: 'step' }], { _attachedFiles: [media('/x/a.mp4', 'tool-media')] }),
      assistant('done', { _attachedFiles: [media('/x/a.mp4', 'message-ref')] }),
    ]);

    expect(result[1]?._attachedFiles).toEqual([]);
    expect(result[2]?._attachedFiles).toHaveLength(1);
  });

  it('lets a Gateway content block own the file', () => {
    const result = dedupeConversationMedia([
      user,
      assistant('done', { _attachedFiles: [media('/x/a.mp4', 'message-ref')] }),
      assistant([{ type: 'attachment', attachment: { url: '/x/a.mp4', kind: 'video', label: 'a.mp4' } }]),
    ]);

    expect(result[1]?._attachedFiles).toEqual([]);
  });

  it("does not repeat the user's own upload on the reply", () => {
    const result = dedupeConversationMedia([
      { role: 'user', content: 'play this', _attachedFiles: [media('/x/a.mp4', 'message-ref')] },
      assistant('sure', { _attachedFiles: [media('/x/a.mp4', 'message-ref')] }),
    ]);

    expect(result[0]?._attachedFiles).toHaveLength(1);
    expect(result[1]?._attachedFiles).toEqual([]);
  });

  it('does not touch a later turn that uses the same file again', () => {
    const messages = [
      user,
      assistant('first', { _attachedFiles: [media('/x/a.mp4', 'message-ref')] }),
      user,
      assistant('second', { _attachedFiles: [media('/x/a.mp4', 'message-ref')] }),
    ];

    expect(dedupeConversationMedia(messages)).toBe(messages);
  });

  it('leaves documents and images to their existing rules', () => {
    const pdf = { fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 0, preview: null, filePath: '/x/a.pdf' };
    const messages = [user, assistant('a', { _attachedFiles: [pdf] }), assistant('b', { _attachedFiles: [pdf] })];
    expect(dedupeConversationMedia(messages)).toBe(messages);
  });

});

describe('attachToolMediaToTurns', () => {
  const neverDropped = () => false;
  const userAt = (timestamp: number): RawMessage => ({ role: 'user', content: 'go', timestamp });
  const toolCall = (id: string, args: unknown = {}): RawMessage => assistant([{ type: 'toolCall', id, name: 'tool', arguments: args }]);
  const toolResult = (id: string, content: string, details?: unknown): RawMessage => ({
    role: 'toolresult',
    toolCallId: id,
    content: [{ type: 'text', text: content }],
    details,
  });
  const declared = { attachments: [{ type: 'video', path: '/x/a.mp4', mimeType: 'video/mp4' }] };
  const paths = (message: RawMessage | undefined) => (message?._attachedFiles ?? []).map((file) => file.filePath);

  it('gives a multi-step turn one owner: its last visible message', () => {
    const result = attachToolMediaToTurns([
      userAt(1000),
      toolCall('1'),
      toolResult('1', 'done', declared),
      toolCall('2'),
      toolResult('2', 'verified'),
      assistant('Here it is.'),
    ], neverDropped);

    expect(paths(result[1])).toEqual([]);
    expect(paths(result[3])).toEqual([]);
    expect(paths(result[5])).toEqual(['/x/a.mp4']);
  });

  it('keeps media when a run ends on a tool result', () => {
    const result = attachToolMediaToTurns([userAt(1000), toolCall('1'), toolResult('1', 'done', declared)], neverDropped);
    expect(paths(result[1])).toEqual(['/x/a.mp4']);
  });

  it('never gives media to a message history will drop', () => {
    const result = attachToolMediaToTurns(
      [userAt(1000), toolCall('1'), toolResult('1', 'done', declared), assistant('NO_REPLY')],
      (message) => message.content === 'NO_REPLY',
    );
    expect(paths(result[1])).toEqual(['/x/a.mp4']);
    expect(result[3]?._attachedFiles).toBeUndefined();
  });

  it('keeps media in its own turn when the next user message arrives first', () => {
    const result = attachToolMediaToTurns([
      userAt(1000),
      toolCall('1'),
      toolResult('1', 'done', declared),
      userAt(2000),
      assistant('Unrelated reply.'),
    ], neverDropped);

    expect(paths(result[1])).toEqual(['/x/a.mp4']);
    expect(result[4]?._attachedFiles).toBeUndefined();
  });

  it('stamps found paths with the start of their own turn, in ms', () => {
    const result = attachToolMediaToTurns([
      userAt(1_800_000_000),
      toolCall('1'),
      toolResult('1', 'wrote /x/out.wav'),
    ], neverDropped);

    expect(result[1]?._attachedFiles?.[0]).toMatchObject({ source: 'tool-result', producedAfter: 1_800_000_000_000 });
  });

  it('does not let an internal injected message restart the turn', () => {
    const result = attachToolMediaToTurns([
      userAt(1_800_000_000),
      toolCall('1'),
      { role: 'user', content: 'System (untrusted): exec finished', timestamp: 1_800_000_500 },
      toolResult('1', 'wrote /x/out.wav'),
    ], (message) => message.role === 'user' && String(message.content).startsWith('System'));

    expect(result[1]?._attachedFiles?.[0]?.producedAfter).toBe(1_800_000_000_000);
  });

  it('finds an output path that only appears in a command line', () => {
    const result = attachToolMediaToTurns([
      userAt(1000),
      toolCall('1', { command: 'python synth.py --out /srv/out/speech.wav' }),
      toolResult('1', 'ok'),
    ], neverDropped);

    expect(paths(result[1])).toEqual(['/srv/out/speech.wav']);
  });

  it('reads OpenAI-style tool call arguments too', () => {
    const result = attachToolMediaToTurns([
      userAt(1000),
      assistant('Working', { tool_calls: [{ id: '1', function: { name: 'exec', arguments: { command: 'gen -o /srv/a.mp3' } } }] } as Partial<RawMessage>),
    ], neverDropped);

    expect(paths(result[1])).toEqual(['/srv/a.mp3']);
  });

  it('declared beats found for the same file', () => {
    const result = attachToolMediaToTurns([
      userAt(1000),
      toolCall('1', { command: 'gen -o /x/a.mp4' }),
      toolResult('1', 'wrote /x/a.mp4', declared),
    ], neverDropped);

    expect(result[1]?._attachedFiles).toHaveLength(1);
    expect(result[1]?._attachedFiles?.[0]?.source).toBe('tool-media');
  });

  it('does not repeat what the owner already carries', () => {
    const owner = assistant('Done', {
      _attachedFiles: [{ fileName: 'a.mp4', mimeType: 'video/mp4', fileSize: 1, preview: null, filePath: '/x/a.mp4' }],
    });
    const result = attachToolMediaToTurns([userAt(1000), toolCall('1'), toolResult('1', 'ok', declared), owner], neverDropped);
    expect(result[3]).toBe(owner);
  });

  it('returns the same array when no tool produced media', () => {
    const messages = [userAt(1000), toolCall('1'), toolResult('1', 'nothing here'), assistant('Done')];
    expect(attachToolMediaToTurns(messages, neverDropped)).toBe(messages);
  });

  it('stays fast on megabytes of base64 in a tool result', () => {
    const base64 = 'QUJD+/'.repeat(600_000);
    const started = performance.now();
    const result = extractToolResultMedia({ content: [{ type: 'image', data: base64 }, { type: 'text', text: base64 }] });
    expect(result).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('stays fast on a long payload just under the scanning cap', () => {
    const payload = 'QUJD+/'.repeat(40_000);
    const started = performance.now();
    expect(extractToolResultMedia({ content: payload })).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('MessageRenderProjection owns resource visibility', () => {
  it('keeps a message that only carries a media block', () => {
    const projection = projectMessageRender(assistant([
      { type: 'attachment', attachment: { url: '/x/a.mp3', kind: 'audio', label: 'a.mp3' } },
    ]), flags);

    expect(projection.hasRenderableContent).toBe(true);
    expect(projection.candidateAttachments.map((file) => mediaKindOf(file))).toEqual(['audio']);
  });

  it('keeps a resource-only message when its turn is folded', () => {
    const projection = projectMessageRender(assistant([
      { type: 'attachment', attachment: { url: '/x/a.mp4', kind: 'video', label: 'a.mp4' } },
    ]), { ...flags, suppressAssistantText: true, suppressToolCards: true });

    expect(projection.hasRenderableContent).toBe(true);
  });

  it('counts an unrecognized resource as renderable', () => {
    const projection = projectMessageRender(assistant([{ type: 'canvas', title: 'Board' }]), flags);
    expect(projection.resources).toHaveLength(1);
    expect(projection.hasRenderableContent).toBe(true);
  });

  it('still hides a message with nothing to show', () => {
    const projection = projectMessageRender(assistant([{ type: 'text', text: '  ' }]), flags);
    expect(projection.hasRenderableContent).toBe(false);
  });

  it('does not double-count a block already enriched onto the message', () => {
    const projection = projectMessageRender(assistant(
      [{ type: 'attachment', attachment: { url: '/x/a.mp3', kind: 'audio', label: 'a.mp3' } }],
      { _attachedFiles: [{ fileName: 'a.mp3', mimeType: 'audio/mpeg', fileSize: 10, preview: null, filePath: '/x/a.mp3' }] },
    ), flags);

    expect(projection.candidateAttachments).toHaveLength(1);
  });

  it('does not double-count a Gateway image once enrichment attached it', () => {
    const url = '/api/chat/media/outgoing/s/id/full';
    const projection = projectMessageRender(assistant(
      [{ type: 'image', url, mimeType: 'image/png', alt: 'a' }],
      { _attachedFiles: [{ fileName: 'a', mimeType: 'image/png', fileSize: 0, preview: null, gatewayUrl: url, source: 'gateway-media' }] },
    ), flags);

    expect(projection.resources).toEqual([]);
  });

  it('reports an omitted image only when no other image shows it', () => {
    const omitted = { type: 'image', omitted: true, bytes: 10 };
    expect(projectMessageRender(assistant([omitted]), flags).resources).toHaveLength(1);
    expect(projectMessageRender(assistant([omitted], {
      _attachedFiles: [{ fileName: 'a.png', mimeType: 'image/png', fileSize: 0, preview: 'data:image/png;base64,A', filePath: '/a.png' }],
    }), flags).resources).toEqual([]);
  });

  it('turns an explicit Tool UI fence with no renderer into a card, not raw JSON', () => {
    const projection = projectMessageRender(assistant([
      'Here it is:',
      '```tool-ui',
      JSON.stringify({ type: 'sankey', title: 'Flows', url: 'https://x.example/f' }),
      '```',
    ].join('\n')), flags);

    expect(projection.displayText).toBe('Here it is:');
    expect(projection.resources).toEqual([expect.objectContaining({ kind: 'unknown', type: 'sankey', title: 'Flows' })]);
  });

  it('keeps ordinary JSON fences as code', () => {
    const projection = projectMessageRender(assistant('```json\n{"a":1}\n```'), flags);
    expect(projection.displayText).toContain('{"a":1}');
    expect(projection.resources).toEqual([]);
  });

  it('offers a relative artifact the reply names as a candidate', () => {
    const projection = projectMessageRender(assistant('Audio saved to `out/speech.wav`.'), flags);
    expect(projection.candidateAttachments.map((file) => file.filePath)).toEqual(['out/speech.wav']);
  });

  it('does not raise a relative card from narration folded out of sight', () => {
    const projection = projectMessageRender(assistant('Saving to `out/speech.wav` next.'), { ...flags, suppressAssistantText: true });
    expect(projection.candidateAttachments).toEqual([]);
  });

  it('keeps the voice note flag from the block when the attachment lacks it', () => {
    const projection = projectMessageRender(assistant(
      [{ type: 'attachment', attachment: { url: '/x/a.opus', kind: 'audio', label: 'a.opus', isVoiceNote: true } }],
      { _attachedFiles: [{ fileName: 'a.opus', mimeType: 'audio/opus', fileSize: 1, preview: null, filePath: '/x/a.opus' }] },
    ), flags);

    expect(projection.candidateAttachments).toEqual([expect.objectContaining({ filePath: '/x/a.opus', isVoiceNote: true })]);
  });
});

describe('message text and images', () => {
  it('keeps remote and inline Markdown images so they reach the renderer', () => {
    const text = 'Look ![Beacon](https://x.example/p.png) and ![Inline](data:image/png;base64,AAAA)';
    expect(extractText(assistant(text))).toBe(text);
  });

  it('still removes Gateway and local Markdown images, which become attachment cards', () => {
    expect(extractText(assistant('A ![x](/api/chat/media/outgoing/s/id/full) B'))).toBe('A  B');
    expect(extractText(assistant('A ![x](/tmp/a.png) B'))).toBe('A  B');
  });

  it('strips opus artifact markers from the bubble', () => {
    expect(extractText(assistant('Done\nMEDIA:/x/voice.opus'))).toBe('Done');
  });

  it('reads the Gateway input_image block and the OpenAI spelling', () => {
    expect(extractImages(assistant([
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } },
    ]))).toEqual([
      { mimeType: 'image/png', url: 'data:image/png;base64,AAAA' },
      { mimeType: 'image/jpeg', url: 'data:image/jpeg;base64,BBBB' },
    ]);
  });

  it('only treats inline sources as directly loadable', () => {
    expect(isUnresolvableImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isUnresolvableImageUrl('blob:abc')).toBe(false);
    for (const url of ['https://x.example/a.png', '/api/chat/media/a', 'C:\\a.png', 'file:///a.png', 'a.png', 'data:text/html,x']) {
      expect(isUnresolvableImageUrl(url)).toBe(true);
    }
  });
});
