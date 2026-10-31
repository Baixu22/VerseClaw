/**
 * Local fixtures for the conversation resource E2E. Everything is on disk under
 * the test's isolated home, so the real Main file boundary serves it: no network
 * and no mocked bytes. Message shapes mirror what `openclaw_runtime` produces;
 * see the matrix in harness/specs/tasks/chat-conversation-resource-rendering.md.
 */
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CLIP_WEBM_BASE64 = [
  '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',
].join('');

const BLUE_PNG_BASE64 = [
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAaUlEQVR4nNXOQQ0AIBDAsJHM',
  'DApRih9E3IOsCrr2uZRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJ',
  'nMRJnMRJnMT5OzD1AEw4AjPlQYXyAAAAAElFTkSuQmCC',
].join('');

const ORANGE_PNG_BASE64 = [
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAaUlEQVR4nNXOQQ0AIBDAsJFM',
  'Ep7wjgpE3IOsCrru2ZRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJ',
  'nMRJnMRJnMT5OzD1AJCYAkOarg1fAAAAAElFTkSuQmCC',
].join('');

const MINIMAL_PDF = [
  '%PDF-1.1',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
].join('\n');

/** A short mono PCM tone. Written in code because a WAV is just a header and samples. */
function makeWav(seconds = 0.6, frequency = 440): Buffer {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate * seconds);
  const buffer = Buffer.alloc(44 + samples);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write('WAVEfmt ', 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeUInt8(128 + Math.round(60 * Math.sin((2 * Math.PI * frequency * index) / sampleRate)), 44 + index);
  }
  return buffer;
}

export const GATEWAY_ATTACHMENT_ID = '11111111-1111-4111-8111-111111111111';
export const SESSION_KEY = 'agent:main:main';
export const REMOTE_HOST = 'media.example.invalid';
const GATEWAY_IMAGE_URL = `/api/chat/media/outgoing/${encodeURIComponent(SESSION_KEY)}/${GATEWAY_ATTACHMENT_ID}/full`;

export type ResourcePaths = {
  workspace: string;
  ttsAudio: string;
  musicAudio: string;
  clip: string;
  externalAudio: string;
  oldListedAudio: string;
  narrationAudio: string;
  lateAudio: string;
  brokenVideo: string;
  gatewayImage: string;
  localImage: string;
  report: string;
  turnStartSeconds: number;
};

async function writeFixture(path: string, data: Buffer | string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return path;
}

/** The file a Retry should find: absent until the test writes it. */
export async function writeLateAudio(paths: ResourcePaths): Promise<void> {
  await writeFixture(paths.lateAudio, makeWav(0.4, 523));
}

export async function writeResourceFixtures(homeDir: string): Promise<ResourcePaths> {
  const openclaw = join(homeDir, '.openclaw');
  const media = join(openclaw, 'media');
  const workspace = join(openclaw, 'workspace');
  // The turn started before the fixtures were written, as a real run's output would be.
  const turnStartSeconds = Math.floor(Date.now() / 1000) - 300;

  const paths: ResourcePaths = {
    workspace,
    ttsAudio: await writeFixture(join(media, 'tts-reply.wav'), makeWav()),
    musicAudio: await writeFixture(join(media, 'theme.wav'), makeWav(0.8, 330)),
    clip: await writeFixture(join(media, 'clip.webm'), Buffer.from(CLIP_WEBM_BASE64, 'base64')),
    externalAudio: await writeFixture(join(workspace, 'system', 'speech-output.wav'), makeWav(0.5, 587)),
    oldListedAudio: await writeFixture(join(workspace, 'system', 'archive-old.wav'), makeWav(0.3, 196)),
    narrationAudio: await writeFixture(join(workspace, 'out', 'narration.wav'), makeWav(0.5, 494)),
    lateAudio: join(media, 'later.wav'),
    // Named .mp4 and declared video/mp4, with bytes no decoder accepts.
    brokenVideo: await writeFixture(join(media, 'broken.mp4'), Buffer.from('this is not a video file at all')),
    gatewayImage: await writeFixture(join(media, 'outgoing', 'originals', 'poster.png'), Buffer.from(BLUE_PNG_BASE64, 'base64')),
    localImage: await writeFixture(join(media, 'local-render.png'), Buffer.from(ORANGE_PNG_BASE64, 'base64')),
    report: await writeFixture(join(media, 'report.pdf'), MINIMAL_PDF),
    turnStartSeconds,
  };

  // A file that existed long before the turn: `ls` lists it, but nothing produced it.
  const longAgo = new Date((turnStartSeconds - 86_400) * 1000);
  await utimes(paths.oldListedAudio, longAgo, longAgo);

  await writeFixture(join(media, 'outgoing', 'records', `${GATEWAY_ATTACHMENT_ID}.json`), JSON.stringify({
    attachmentId: GATEWAY_ATTACHMENT_ID,
    sessionKey: SESSION_KEY,
    alt: 'Generated poster',
    original: { path: paths.gatewayImage, contentType: 'image/png', width: 64, height: 48, sizeBytes: 183, filename: 'poster.png' },
  }));

  return paths;
}

function surface(payload: Record<string, unknown>): string {
  return ['```tool-ui', JSON.stringify(payload), '```'].join('\n');
}

export function buildResourceHistory(paths: ResourcePaths): Array<Record<string, unknown>> {
  const at = (offset: number) => paths.turnStartSeconds + offset;
  const user = (text: string, offset: number) => ({ role: 'user', content: [{ type: 'text', text }], timestamp: at(offset) });
  const assistant = (content: unknown, offset: number, extra: Record<string, unknown> = {}) => ({
    role: 'assistant',
    content,
    timestamp: at(offset),
    ...extra,
  });
  const toolCall = (id: string, name: string, offset: number, args: unknown = {}) => assistant(
    [{ type: 'toolCall', id, name, arguments: args }],
    offset,
    { stopReason: 'toolUse' },
  );
  const toolResult = (id: string, name: string, offset: number, text: string, details?: unknown) => ({
    role: 'toolResult',
    toolCallId: id,
    toolName: name,
    content: [{ type: 'text', text }],
    details,
    timestamp: at(offset),
  });
  const text = (value: string) => [{ type: 'text', text: value }];

  return [
    // The Gateway's own audio bubble, as chat-webchat-media.ts builds it.
    user('Read this aloud', 0),
    toolCall('tts-1', 'tts', 1, { text: 'hello' }),
    toolResult('tts-1', 'tts', 2, '(spoken) hello', {
      audioPath: paths.ttsAudio,
      provider: 'edge',
      media: { mediaUrl: paths.ttsAudio, trustedLocalMedia: true, audioAsVoice: true },
    }),
    assistant([
      { type: 'text', text: 'Audio reply' },
      {
        type: 'attachment',
        attachment: { url: paths.ttsAudio, kind: 'audio', label: 'tts-reply.wav', mimeType: 'audio/wav', isVoiceNote: true },
      },
    ], 3, { model: 'gateway-injected', idempotencyKey: 'run-1:assistant-media' }),

    // A run that ends on the tool: the media is the only thing the turn left.
    user('Compose a theme', 10),
    toolCall('music-1', 'music_generate', 11, { prompt: 'theme' }),
    toolResult('music-1', 'music_generate', 12, 'Generated 1 track with suno/v5.', {
      provider: 'suno',
      model: 'v5',
      count: 1,
      media: {
        mediaUrls: [paths.musicAudio],
        attachments: [{ type: 'audio', path: paths.musicAudio, mimeType: 'audio/wav', name: 'theme.wav' }],
      },
      attachments: [{ type: 'audio', path: paths.musicAudio, mimeType: 'audio/wav', name: 'theme.wav' }],
      paths: [paths.musicAudio],
    }),

    // Reply text alongside media, in a folded run segment.
    user('Make a short video', 20),
    toolCall('video-1', 'video_generate', 21, { prompt: 'test pattern' }),
    toolResult('video-1', 'video_generate', 22, 'Generated 1 video with veo/3.', {
      provider: 'veo',
      model: '3',
      count: 1,
      media: {
        mediaUrls: [paths.clip],
        attachments: [{ type: 'video', path: paths.clip, mimeType: 'video/webm', name: 'clip.webm' }],
      },
      attachments: [{ type: 'video', path: paths.clip, mimeType: 'video/webm', name: 'clip.webm' }],
      paths: [paths.clip],
    }),
    assistant(text('Your video is ready.'), 23),

    // A system the agent is developing produces the artifact; no runtime generator involved.
    user('Run the speech system you are building', 30),
    toolCall('exec-1', 'exec', 31, { command: 'python synth.py && ls system/*.wav' }),
    toolResult('exec-1', 'exec', 32, `synth: wrote ${paths.externalAudio}\n${paths.oldListedAudio}`),
    assistant(text('The system finished. Narration saved to `out/narration.wav`, while `out/never-written.wav` was skipped.'), 33),

    // Every failure state, on one message.
    user('Show the ones that may fail', 40),
    assistant([
      { type: 'text', text: 'Some of these may not play.' },
      { type: 'attachment', attachment: { url: paths.lateAudio, kind: 'audio', label: 'later.wav', mimeType: 'audio/wav' } },
      { type: 'attachment', attachment: { url: paths.brokenVideo, kind: 'video', label: 'broken.mp4', mimeType: 'video/mp4' } },
      { type: 'attachment', attachment: { url: `https://${REMOTE_HOST}/remote.mp4`, kind: 'video', label: 'remote.mp4', mimeType: 'video/mp4' } },
      { type: 'audio', label: 'Voice memo', source: { type: 'base64', media_type: 'audio/mpeg', omitted: true, bytes: 4096 } },
    ], 41),

    // Images: Gateway, local, Markdown and gallery all share one resolver.
    user('Show the images', 50),
    assistant([
      {
        type: 'image',
        url: GATEWAY_IMAGE_URL,
        openUrl: GATEWAY_IMAGE_URL,
        alt: 'Generated poster',
        mimeType: 'image/png',
        width: 64,
        height: 48,
      },
    ], 51, { model: 'gateway-injected', idempotencyKey: 'run-2:assistant-media' }),
    assistant(text([
      'A local render and a remote image.',
      '',
      `MEDIA:${paths.localImage}`,
      '',
      `![Tracking pixel](https://${REMOTE_HOST}/pixel.png?token=SECRET-TOKEN)`,
      '',
      surface({
        type: 'image-gallery',
        id: 'gallery-1',
        title: 'Gallery',
        images: [
          { url: `data:image/png;base64,${BLUE_PNG_BASE64}`, alt: 'Inline tile', caption: 'Inline' },
          { url: GATEWAY_IMAGE_URL, alt: 'Gateway tile', caption: 'Gateway' },
          { url: paths.localImage, alt: 'Local tile', caption: 'Local' },
          { url: `https://${REMOTE_HOST}/tile.png`, alt: 'Remote tile', caption: 'Remote' },
          { url: 'not-a-real-image.png', alt: 'Broken tile', caption: 'Broken' },
        ],
      }),
    ].join('\n')), 52),

    // Structured data.
    user('Show the numbers', 60),
    assistant(text([
      surface({
        type: 'chart',
        id: 'chart-line',
        title: 'Latency line',
        chartType: 'line',
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        series: [{ name: 'p50', data: [120, 132, 101, 134, 90] }, { name: 'p95', data: [220, 282, 201, 234, 190] }],
      }),
      surface({
        type: 'chart',
        id: 'chart-bar',
        title: 'Revenue bars',
        chartType: 'bar',
        labels: ['Q1', 'Q2', 'Q3'],
        series: [{ name: 'North', data: [12, 18, 9] }, { name: 'South', data: [8, 14, 16] }],
      }),
      surface({
        type: 'chart',
        id: 'chart-area',
        title: 'Traffic area',
        chart_type: 'area',
        labels: ['Jan', 'Feb', 'Mar', 'Apr'],
        series: [{ name: 'Visits', data: [1200, 2400, 1800, 3200] }],
      }),
      surface({
        type: 'chart',
        id: 'chart-pie',
        title: 'Share pie',
        chartType: 'pie',
        labels: ['Direct', 'Search', 'Referral'],
        series: [{ name: 'Share', data: [55, 30, 15] }],
      }),
      surface({
        type: 'chart',
        id: 'chart-scatter',
        title: 'Unsupported scatter',
        chartType: 'scatter',
        labels: ['A', 'B'],
        series: [{ name: 'Points', data: [1, 2] }],
      }),
      surface({
        type: 'table',
        id: 'table-1',
        title: 'Regions',
        columns: [{ key: 'region', label: 'Region' }, { key: 'sales', label: 'Sales', align: 'right' }],
        rows: [{ region: 'North', sales: 39 }, { region: 'South', sales: 38 }],
      }),
      surface({
        type: 'weather-widget',
        id: 'weather-1',
        location: 'Seattle, WA',
        temperature: 52,
        unit: 'fahrenheit',
        condition: 'Light rain',
        forecast: [{ day: 'Mon', condition: 'Rain', high: 55, low: 46 }],
      }),
    ].join('\n\n')), 61),
    toolCall('search-1', 'web_search', 62, { query: 'conversation resources' }),
    toolResult('search-1', 'web_search', 63, '{}', {
      query: 'conversation resources',
      provider: 'tavily',
      results: [{ title: 'Search source', url: `https://${REMOTE_HOST}/source`, content: 'A landed source.' }],
    }),
    assistant(text('Those are the numbers.'), 64),

    // Files, links, and things the app has no renderer for.
    user('Share the rest', 70),
    assistant([
      {
        type: 'text',
        text: [
          `Report: MEDIA:${paths.report}`,
          '',
          `[Project docs](https://${REMOTE_HOST}/docs)`,
          '',
          `An [inline link](https://${REMOTE_HOST}/inline) stays in the sentence.`,
          '',
          surface({ type: 'sankey', title: 'Flow diagram', description: 'Traffic between stages', url: `https://${REMOTE_HOST}/flow?api_key=SECRET-KEY` }),
        ].join('\n'),
      },
      { type: 'canvas', preview: { title: 'Live dashboard', url: `https://${REMOTE_HOST}/board?token=SECRET-TOKEN` } },
    ], 71),
  ];
}
