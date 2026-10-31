/**
 * Drives `useChatStore.loadHistory` in `src/stores/chat.ts`: the store Electron
 * runs. The split `chat/history-actions.ts` path is not active, and a resource fix
 * that only reached it would pass its own tests while changing nothing in the app.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawMessage } from '@/stores/chat';

const { gatewayRpcMock, thumbnails } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  thumbnails: vi.fn(async () => ({})),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      status: { state: 'running', port: 18789, connectedAt: 1 },
      rpc: gatewayRpcMock,
    }),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: { getState: () => ({ agents: [] }) },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: { media: { thumbnails } },
  hostApiFetch: vi.fn().mockResolvedValue({ success: true, summaries: [] }),
}));

const SESSION = 'agent:main:session-1';
const TURN_START = 1_800_000_000;

async function loadMessages(history: unknown[]): Promise<RawMessage[]> {
  gatewayRpcMock.mockImplementation(async (method: string) => {
    if (method === 'chat.history') return { messages: history };
    if (method === 'sessions.list') return { sessions: [{ key: SESSION }] };
    return {};
  });
  const { useChatStore } = await import('@/stores/chat');
  useChatStore.setState({ currentSessionKey: SESSION, currentAgentId: 'main', messages: [] });
  await useChatStore.getState().loadHistory();
  return useChatStore.getState().messages;
}

function attachmentsOf(message: RawMessage | undefined) {
  return (message?._attachedFiles ?? []).map((file) => ({
    path: file.filePath,
    source: file.source,
    producedAfter: file.producedAfter,
  }));
}

const user = (text: string) => ({ role: 'user', content: text, timestamp: TURN_START });
const toolCall = (id: string, name: string, args: unknown = {}) => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id, name, arguments: args }],
  timestamp: TURN_START + 1,
});
const toolResult = (id: string, name: string, text: string, details?: unknown) => ({
  role: 'toolResult',
  toolCallId: id,
  toolName: name,
  content: [{ type: 'text', text }],
  details,
  timestamp: TURN_START + 2,
});
const reply = (text: string) => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  timestamp: TURN_START + 3,
});

describe('conversation resources through the production history path', () => {
  beforeEach(() => {
    vi.resetModules();
    gatewayRpcMock.mockReset();
    thumbnails.mockClear();
  });

  it('attaches generated video to the reply that follows the tool', async () => {
    const messages = await loadMessages([
      user('make a clip'),
      toolCall('v1', 'video_generate'),
      toolResult('v1', 'video_generate', 'Generated 1 video.', {
        attachments: [{ type: 'video', path: '/h/.openclaw/media/clip.mp4', mimeType: 'video/mp4', name: 'clip' }],
      }),
      reply('Your clip is ready.'),
    ]);

    expect(attachmentsOf(messages.at(-1))).toEqual([
      { path: '/h/.openclaw/media/clip.mp4', source: 'tool-media', producedAfter: undefined },
    ]);
  });

  it('marks an external tool artifact with the start of its turn', async () => {
    const messages = await loadMessages([
      user('run the speech system'),
      toolCall('e1', 'exec', { command: 'python synth.py' }),
      toolResult('e1', 'exec', 'synth: wrote /srv/app/out/speech.wav'),
      reply('Done.'),
    ]);

    expect(attachmentsOf(messages.at(-1))).toEqual([
      { path: '/srv/app/out/speech.wav', source: 'tool-result', producedAfter: TURN_START * 1000 },
    ]);
  });

  it('keeps media when the run ends on a tool result with no reply', async () => {
    const messages = await loadMessages([
      user('say it'),
      toolCall('t1', 'tts'),
      toolResult('t1', 'tts', '(spoken) hello', { audioPath: '/h/tts.opus', media: { mediaUrl: '/h/tts.opus' } }),
    ]);

    expect(attachmentsOf(messages.at(-1))).toEqual([
      { path: '/h/tts.opus', source: 'tool-media', producedAfter: undefined },
    ]);
  });

  it('does not lose attachments to a NO_REPLY turn that history then drops', async () => {
    const messages = await loadMessages([
      user('send it'),
      toolCall('m1', 'music_generate'),
      toolResult('m1', 'music_generate', 'Generated 1 track.', {
        attachments: [{ type: 'audio', path: '/h/song.mp3', mimeType: 'audio/mpeg' }],
      }),
      reply('NO_REPLY'),
    ]);

    const owner = messages.find((message) => message._attachedFiles?.length);
    expect(owner).toBeDefined();
    expect(attachmentsOf(owner).map((entry) => entry.path)).toEqual(['/h/song.mp3']);
  });

  it('keeps the Gateway audio bubble and gives it one owner', async () => {
    const messages = await loadMessages([
      user('read this'),
      toolCall('t1', 'tts'),
      toolResult('t1', 'tts', '(spoken) hi', { audioPath: '/h/v.opus', media: { mediaUrl: '/h/v.opus', trustedLocalMedia: true } }),
      reply('Here you go.'),
      {
        role: 'assistant',
        model: 'gateway-injected',
        idempotencyKey: 'run:assistant-media',
        content: [
          { type: 'text', text: 'Audio reply' },
          { type: 'attachment', attachment: { url: '/h/v.opus', kind: 'audio', label: 'v.opus', mimeType: 'audio/opus' } },
        ],
        timestamp: TURN_START + 4,
      },
    ]);

    const replyMessage = messages.find((message) => JSON.stringify(message.content).includes('Here you go'));
    expect(replyMessage?._attachedFiles ?? []).toEqual([]);
    expect(JSON.stringify(messages.at(-1)?.content)).toContain('"kind":"audio"');
  });

  it('removes the duplicate when a reply repeats a declared artifact', async () => {
    const messages = await loadMessages([
      user('make audio'),
      toolCall('m1', 'music_generate'),
      toolResult('m1', 'music_generate', 'Generated.', {
        attachments: [{ type: 'audio', path: '/h/song.mp3', mimeType: 'audio/mpeg' }],
      }),
      toolCall('m2', 'exec', { command: 'echo' }),
      toolResult('m2', 'exec', 'ok'),
      reply('Saved: MEDIA:/h/song.mp3'),
    ]);

    const withSong = messages.filter((message) => (message._attachedFiles ?? []).some((file) => file.filePath === '/h/song.mp3'));
    expect(withSong).toHaveLength(1);
    expect(withSong[0]).toBe(messages.at(-1));
  });

  it('keeps a thinking-plus-media message that used to count as internal', async () => {
    const messages = await loadMessages([
      user('go'),
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'done now' },
          { type: 'attachment', attachment: { url: '/h/a.mp3', kind: 'audio', label: 'a.mp3' } },
        ],
        timestamp: TURN_START + 1,
      },
    ]);

    expect(JSON.stringify(messages.at(-1)?.content)).toContain('"kind":"audio"');
  });

  it('surfaces Markdown Gateway images that the bubble text strips', async () => {
    const url = '/api/chat/media/outgoing/s/abc/full';
    const messages = await loadMessages([user('draw'), reply(`Here: ![Astronaut](${url})`)]);

    expect(messages.at(-1)?._attachedFiles).toEqual([
      expect.objectContaining({ gatewayUrl: url, fileName: 'Astronaut', source: 'gateway-media' }),
    ]);
  });

  it('does not treat a remote flat image block as Gateway media', async () => {
    const messages = await loadMessages([
      user('draw'),
      { role: 'assistant', content: [{ type: 'image', url: 'https://x.example/a.png' }], timestamp: TURN_START + 1 },
    ]);

    expect(messages.at(-1)?._attachedFiles ?? []).toEqual([]);
  });

  it('gives a multi-step run one card, on the reply', async () => {
    const messages = await loadMessages([
      user('make and check a clip'),
      toolCall('v1', 'video_generate'),
      toolResult('v1', 'video_generate', 'Generated.', {
        attachments: [{ type: 'video', path: '/h/clip.mp4', mimeType: 'video/mp4' }],
      }),
      toolCall('e1', 'exec', { command: 'ffprobe /h/clip.mp4' }),
      toolResult('e1', 'exec', 'duration=1.0 /h/clip.mp4'),
      reply('Checked and ready.'),
    ]);

    const owners = messages.filter((message) => (message._attachedFiles ?? []).some((file) => file.filePath === '/h/clip.mp4'));
    expect(owners).toHaveLength(1);
    expect(owners[0]).toBe(messages.at(-1));
    expect(owners[0]?._attachedFiles?.[0]?.source).toBe('tool-media');
  });

  it('finds what an external system wrote when only the command names it', async () => {
    const messages = await loadMessages([
      user('run it'),
      toolCall('e1', 'exec', { command: 'node gen.js --output /srv/app/out.mp3' }),
      toolResult('e1', 'exec', 'done'),
      reply('Finished.'),
    ]);

    expect(attachmentsOf(messages.at(-1))).toEqual([
      { path: '/srv/app/out.mp3', source: 'tool-result', producedAfter: TURN_START * 1000 },
    ]);
  });

  it('does not turn a Tool UI payload path into a second file card', async () => {
    const localPath = String.raw`C:\work\local.png`;
    const gallery = JSON.stringify({
      type: 'image-gallery',
      id: 'gallery-1',
      images: [{ url: localPath, alt: 'Local tile' }],
    });
    const messages = await loadMessages([
      user('show the image'),
      reply([
        'Here it is.',
        '',
        'MEDIA:' + localPath,
        '',
        '```tool-ui',
        gallery,
        '```',
      ].join('\n')),
    ]);

    const files = (messages.at(-1)?._attachedFiles ?? []).filter((file) => file.filePath === localPath);
    expect(files).toHaveLength(1);
  });

  it('survives a history reload with the same result', async () => {
    const history = [
      user('make a clip'),
      toolCall('v1', 'video_generate'),
      toolResult('v1', 'video_generate', 'Generated.', {
        attachments: [{ type: 'video', path: '/h/clip.mp4', mimeType: 'video/mp4' }],
      }),
      reply('Ready.'),
    ];

    const first = await loadMessages(history);
    const { useChatStore } = await import('@/stores/chat');
    await useChatStore.getState().loadHistory(true);
    const second = useChatStore.getState().messages;

    expect(attachmentsOf(second.at(-1))).toEqual(attachmentsOf(first.at(-1)));
    expect(attachmentsOf(second.at(-1))).toHaveLength(1);
  });
});
