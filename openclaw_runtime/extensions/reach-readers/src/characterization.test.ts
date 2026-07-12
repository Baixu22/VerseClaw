import { describe, expect, it } from 'vitest';

import { ALL_TOOLS, reachReadersPlugin, TOOL_BY_NAME } from './index.js';
import { createCollectingApi } from './common/plugin-entry.js';
import { Schema } from './common/schema.js';
import { errorResult, jsonResult } from './common/tool-shape.js';
import { reinstallHint, utf8Env } from './core/probe.js';
import {
  canHandle,
  canHandleRss,
  orderedBackends,
  safeHostname,
  selectBackend,
} from './core/router.js';
import { parseFeed } from './tools/rss.js';
import { cleanComment, cleanNote, formatXhsResult } from './tools/xiaohongshu.js';
import { injectCookieString } from './tools/xueqiu.js';

const TOOL_NAMES = [
  'web_read',
  'rss_read',
  'v2ex_read',
  'xueqiu_read',
  'bilibili_read',
  'youtube_read',
  'github_read',
  'twitter_read',
  'xiaohongshu_read',
] as const;

describe('tool registration', () => {
  it('registers the nine imported tools in their original order', () => {
    const { api, tools } = createCollectingApi();

    reachReadersPlugin.register(api);

    expect(ALL_TOOLS.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    expect(Object.keys(TOOL_BY_NAME)).toEqual(TOOL_NAMES);
  });

  it('declares every imported reader as readonly', () => {
    expect(ALL_TOOLS.map((tool) => tool.risk)).toEqual(
      TOOL_NAMES.map(() => 'readonly'),
    );
  });
});

describe('public SDK adapters', () => {
  it('produces TypeBox schemas with flat string enums', () => {
    const schema = Schema.object({
      action: Schema.enum(['read', 'check'], 'action'),
      limit: Schema.optional(Schema.integer({ minimum: 1 })),
    }) as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;

    expect(schema.type).toBe('object');
    expect(properties.action).toMatchObject({
      type: 'string',
      enum: ['read', 'check'],
      description: 'action',
    });
    expect(properties.action).not.toHaveProperty('anyOf');
    expect(schema.required).toEqual(['action']);
  });

  it('returns formal agent tool results with model text and private details', () => {
    const success = jsonResult({ status: 'ok', value: 1 });
    const failure = errorResult('failed', { action: 'read' });

    expect(success).toEqual({
      content: [{ type: 'text', text: '{\n  "status": "ok",\n  "value": 1\n}' }],
      details: { status: 'ok', value: 1 },
    });
    expect(failure.details).toEqual({
      status: 'error',
      success: false,
      error: 'failed',
      action: 'read',
    });
  });
});

describe('router', () => {
  it('matches exact domains and subdomains without matching suffix lookalikes', () => {
    expect(canHandle('https://www.bilibili.com/video/BV1', ['bilibili.com'])).toBe(true);
    expect(canHandle('https://evilbilibili.com/video/BV1', ['bilibili.com'])).toBe(false);
    expect(safeHostname('V2EX.com/t/1')).toBe('v2ex.com');
  });

  it('recognizes common RSS URL shapes', () => {
    expect(canHandleRss('https://example.com/feed')).toBe(true);
    expect(canHandleRss('https://example.com/ATOM.xml')).toBe(true);
    expect(canHandleRss('https://example.com/articles')).toBe(false);
  });

  it('moves a known backend override to the front and ignores stale overrides', () => {
    const defaults = ['first', 'second', 'third'];
    expect(orderedBackends('twitter', defaults, () => 'second')).toEqual([
      'second',
      'first',
      'third',
    ]);
    expect(orderedBackends('twitter', defaults, () => 'removed')).toEqual(defaults);
  });

  it('prefers ok over warn and retains broken backend diagnostics', () => {
    const selected = selectBackend([
      { backend: 'broken', status: 'error', message: 'broken diagnostic' },
      { backend: 'fallback', status: 'warn', message: 'fallback warning' },
      { backend: 'primary', status: 'ok', message: 'primary ready' },
    ]);

    expect(selected?.activeBackend).toBe('primary');
    expect(selected?.status).toBe('ok');
    expect(selected?.message).toContain('broken diagnostic');
  });
});

describe('probe', () => {
  it('forces UTF-8 and retains the upstream reinstall prescription', () => {
    expect(utf8Env()).toMatchObject({
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    });
    expect(utf8Env().LANG).toMatch(/\.UTF-8$/);
    expect(reinstallHint('opencli')).toContain('uv tool install --force opencli');
    expect(reinstallHint('opencli')).toContain('pipx reinstall opencli');
  });
});

describe('RSS parser', () => {
  it('parses RSS and Atom entries while stripping markup and CDATA wrappers', () => {
    const rss = parseFeed(`
      <rss><channel><title>Example Feed</title>
      <item><title>First post</title>
      <link>https://example.com/1</link><description><p>Hello</p></description>
      <pubDate>Sun, 12 Jul 2026 00:00:00 GMT</pubDate></item>
      </channel></rss>
    `);
    const atom = parseFeed(`
      <feed><title>Atom Feed</title><entry><title>Entry</title>
      <link href="https://example.com/a"/><summary>Summary</summary>
      <updated>2026-07-12T00:00:00Z</updated></entry></feed>
    `);

    expect(rss).toEqual({
      title: 'Example Feed',
      items: [{
        title: 'First post',
        link: 'https://example.com/1',
        description: 'Hello',
        pubDate: 'Sun, 12 Jul 2026 00:00:00 GMT',
      }],
    });
    expect(atom.items[0]).toMatchObject({
      title: 'Entry',
      link: 'https://example.com/a',
      description: 'Summary',
    });
  });
});

describe('Xiaohongshu cleaners', () => {
  it('keeps useful note and comment fields and drops bulky response metadata', () => {
    const raw = {
      note_card: {
        note_id: 'note-1',
        title: 'Title',
        desc: 'Body',
        user: { nickname: 'Author', avatar: 'drop-me' },
        interact_info: { liked_count: '5', comment_count: '2' },
        image_list: [{ url_default: 'https://img.example/1.jpg', width: 1080 }],
        tag_list: [{ name: 'tag' }],
        comments: [{
          content: 'Nice',
          user_info: { nickname: 'Reader', avatar: 'drop-me' },
          like_count: 1,
          id: 'drop-me',
        }],
        trace_id: 'drop-me',
      },
    };

    expect(cleanNote(raw)).toEqual({
      note_id: 'note-1',
      title: 'Title',
      desc: 'Body',
      user: { nickname: 'Author' },
      liked_count: '5',
      comment_count: '2',
      images: ['https://img.example/1.jpg'],
      tags: ['tag'],
      comments: [{ content: 'Nice', user: 'Reader', like_count: 1 }],
    });
    expect(cleanComment(null)).toBeNull();
    expect(formatXhsResult({ items: [raw] })).toEqual([cleanNote(raw)]);
  });
});

describe('Xueqiu cookie jar', () => {
  it('accepts cookie pairs while ignoring attributes without values', () => {
    expect(() => injectCookieString('xq_a_token=secret; malformed; u=123=456')).not.toThrow();
  });
});
