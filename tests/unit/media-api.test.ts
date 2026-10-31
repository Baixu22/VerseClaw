import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const createFromPathMock = vi.hoisted(() => vi.fn(() => ({
  isEmpty: () => true,
  getSize: () => ({ width: 1, height: 1 }),
  resize: vi.fn(),
  toPNG: vi.fn(),
})));

const configDir = vi.hoisted(() => ({ value: '' }));

vi.mock('../../electron/utils/paths', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../electron/utils/paths')>(),
  getOpenClawConfigDir: () => configDir.value,
}));

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn(),
  },
  nativeImage: {
    createFromPath: createFromPathMock,
  },
}));

describe('media api', () => {
  let testDir: string;

  beforeEach(async () => {
    vi.resetModules();
    createFromPathMock.mockClear();
    testDir = await mkdtemp(join(tmpdir(), 'clawx-media-api-'));
    configDir.value = testDir;
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns SVG thumbnails as original data URLs without nativeImage decoding', async () => {
    const svgPath = join(testDir, 'plan.svg');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>';
    await writeFile(svgPath, svg, 'utf8');

    const { createMediaApi } = await import('../../electron/services/media-api');
    const mediaApi = createMediaApi();

    const result = await mediaApi.thumbnails({
      paths: [{ filePath: svgPath, mimeType: 'image/svg+xml' }],
    });

    expect(createFromPathMock).not.toHaveBeenCalled();
    expect(result[svgPath]).toEqual({
      preview: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      fileSize: Buffer.byteLength(svg),
    });
  });

  describe('Gateway media resolution', () => {
    const attachmentId = '11111111-1111-4111-8111-111111111111';
    const gatewayUrl = `/api/chat/media/outgoing/agent%3Amain%3Amain/${attachmentId}/full`;

    async function writeRecord(original: { path: string; contentType: string }) {
      const recordsDir = join(testDir, 'media', 'outgoing', 'records');
      await mkdir(recordsDir, { recursive: true });
      await writeFile(join(recordsDir, `${attachmentId}.json`), JSON.stringify({ original }), 'utf8');
    }

    it('names the file behind a Gateway URL so the renderer can read it through the sandbox', async () => {
      const mediaPath = join(testDir, 'media', 'clip.mp4');
      await mkdir(join(testDir, 'media'), { recursive: true });
      await writeFile(mediaPath, 'video-bytes');
      await writeRecord({ path: mediaPath, contentType: 'video/mp4' });

      const { createMediaApi } = await import('../../electron/services/media-api');
      const result = await createMediaApi().thumbnails({ paths: [{ gatewayUrl, mimeType: 'video/mp4' }] });

      expect(result[gatewayUrl]).toEqual({
        preview: null,
        fileSize: Buffer.byteLength('video-bytes'),
        resolvedPath: mediaPath,
      });
    });

    it('resolves nothing when the record is gone', async () => {
      const { createMediaApi } = await import('../../electron/services/media-api');
      const result = await createMediaApi().thumbnails({ paths: [{ gatewayUrl, mimeType: 'video/mp4' }] });
      expect(result[gatewayUrl]).toEqual({ preview: null, fileSize: 0 });
    });

    it('resolves nothing when the record points at a missing file', async () => {
      await writeRecord({ path: join(testDir, 'media', 'gone.mp4'), contentType: 'video/mp4' });
      const { createMediaApi } = await import('../../electron/services/media-api');
      const result = await createMediaApi().thumbnails({ paths: [{ gatewayUrl, mimeType: 'video/mp4' }] });
      expect(result[gatewayUrl]).toEqual({ preview: null, fileSize: 0 });
    });

    it('rejects an attachment id that could escape the records directory', async () => {
      const escapeUrl = '/api/chat/media/outgoing/s/..%2F..%2Fsecret/full';
      const { createMediaApi } = await import('../../electron/services/media-api');
      const result = await createMediaApi().thumbnails({ paths: [{ gatewayUrl: escapeUrl, mimeType: 'video/mp4' }] });
      expect(result[escapeUrl]).toEqual({ preview: null, fileSize: 0 });
    });
  });
});
