# Reach Readers

Readonly OpenClaw readers adapted from the Agent Reach TypeScript shadow.
The plugin is enabled at startup and registers these tools:

- `web_read`
- `rss_read`
- `v2ex_read`
- `xueqiu_read`
- `bilibili_read`
- `youtube_read`
- `github_read`
- `twitter_read`
- `xiaohongshu_read`

## Configuration

```json
{
  "browserFallback": "auto",
  "browserProfile": "default",
  "backends": {
    "bilibili": ["bili-cli", "opencli", "api"],
    "twitter": ["twitter-cli", "opencli", "bird"],
    "xiaohongshu": ["opencli", "xiaohongshu-mcp", "xhs-cli"]
  },
  "credentials": {
    "xueqiuCookie": { "source": "env", "provider": "default", "id": "XUEQIU_COOKIE" },
    "twitterAuthToken": { "source": "env", "provider": "default", "id": "TWITTER_AUTH_TOKEN" },
    "twitterCt0": { "source": "env", "provider": "default", "id": "TWITTER_CT0" }
  }
}
```

`browserFallback` supports `auto`, `handoff`, and `off`. In `auto` mode the
original API or CLI backend runs first. Agent Browser is used only as a safe
fallback. Twitter and Xiaohongshu return a visible login handoff rather than
scraping authenticated DOM.

Backend overrides only reorder known imported backends. Unknown names are
ignored and omitted defaults remain available.

## Security

- The plugin never writes Agent Reach configuration or credentials.
- User URLs pass through OpenClaw's SSRF guard, redirect checks, timeouts, and
  response-size limits.
- Commands use bounded argv-only execution with cancellation and no shell
  interpolation.
- Browser cookies are filtered and kept in plugin memory. Cookie values,
  tokens, authorization headers, and SecretInput values are never returned.
- YouTube transcription uses the configured OpenClaw media-understanding
  provider and credentials.

See [UPSTREAM.md](./UPSTREAM.md) for the immutable import hashes and adaptation
ledger.
