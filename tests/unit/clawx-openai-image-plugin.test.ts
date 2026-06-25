import http from 'node:http';
import { Buffer } from 'node:buffer';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

const repoRoot = process.cwd();

vi.mock('openclaw/plugin-sdk/core', () => ({
  definePluginEntry: (entry: unknown) => entry,
}));

vi.mock('openclaw/plugin-sdk/image-generation', () => ({
  createOpenAiCompatibleImageGenerationProvider: (options: {
    defaultBaseUrl: string;
    defaultModel: string;
    resolveBaseUrl: (input: { providerConfig?: { baseUrl?: string }; defaultBaseUrl: string }) => string;
    resolveCount: (input: { req: Record<string, unknown> }) => number;
    buildGenerateRequest: (input: { req: Record<string, unknown>; model: string; count: number }) => {
      body: Record<string, unknown>;
    };
  }) => ({
    async generateImage(req: Record<string, unknown>) {
      const cfg = req.cfg as { models?: { providers?: Record<string, { baseUrl?: string }> } } | undefined;
      const providerConfig = cfg?.models?.providers?.['clawx-openai-image'];
      const baseUrl = options.resolveBaseUrl({ providerConfig, defaultBaseUrl: options.defaultBaseUrl });
      const model = typeof req.model === 'string' ? req.model : options.defaultModel;
      const count = options.resolveCount({ req });
      const request = options.buildGenerateRequest({ req, model, count });
      const response = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      const json = await response.json() as { data?: unknown[] };
      return { images: json.data ?? [] };
    },
  }),
  toImageDataUrl: ({ buffer, mimeType }: { buffer: Buffer; mimeType: string }) => `data:${mimeType};base64,${buffer.toString('base64')}`,
}));

describe('Verse Claw OpenAI image plugin request shape', () => {
  it('does not force deprecated OpenAI Images response_format', async () => {
    const pluginSource = await readFile(
      join(repoRoot, 'resources/openclaw-plugins/clawx-openai-image/index.mjs'),
      'utf8',
    );
    const packageJson = await readFile(join(repoRoot, 'package.json'), 'utf8');
    const bundleScript = await readFile(join(repoRoot, 'scripts/bundle-openclaw.mjs'), 'utf8');

    expect(pluginSource).not.toContain('response_format');
    expect(packageJson).not.toContain('patch-openclaw-image-b64-json');
    expect(bundleScript).not.toContain('response_format: "b64_json"');
  });

  it('omits response_format from generated OpenAI-compatible requests', async () => {
    let requestBody = '';
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        requestBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          data: [{ b64_json: Buffer.from('fake-image').toString('base64') }],
        }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const plugin = await import('../../resources/openclaw-plugins/clawx-openai-image/index.mjs');
      let provider: { generateImage: (req: Record<string, unknown>) => Promise<{ images: unknown[] }> } | undefined;
      plugin.default.register({
        registerImageGenerationProvider(nextProvider: typeof provider) {
          provider = nextProvider;
        },
      });

      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server failed to bind to a port');

      const result = await provider?.generateImage({
        provider: 'clawx-openai-image',
        model: 'gpt-image-2',
        prompt: 'paint a fox',
        quality: 'high',
        outputFormat: 'png',
        background: 'opaque',
        providerOptions: {
          openai: {
            background: 'opaque',
            moderation: 'auto',
            outputCompression: 90,
            user: 'webchat-user',
          },
        },
        cfg: {
          models: {
            providers: {
              'clawx-openai-image': {
                apiKey: 'test-key',
                baseUrl: `http://127.0.0.1:${address.port}/v1`,
              },
            },
          },
        },
        agentDir: '/tmp/clawx-openai-image-test-agent',
        ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
      });

      expect(result?.images).toHaveLength(1);
      expect(JSON.parse(requestBody)).toEqual({
        model: 'gpt-image-2',
        prompt: 'paint a fox',
        n: 1,
        size: '1024x1024',
      });
    } finally {
      server.close();
    }
  }, 15_000);
});
