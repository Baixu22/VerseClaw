# Agent Reach Upstream Record

- Source: `C:\Users\27933\Desktop\Agent-Reach-main\ts-shadow`
- Imported: `2026-07-12`
- ClawX baseline: `3e715f08233e045d6fc813c769dcd7c101e9b9f6`
- Verbatim import commit: `07a658faa`
- Imported files: `22`
- Excluded generated directory: `node_modules`

## SHA-256 Manifest

Paths are relative to both the source directory and this plugin directory.

```text
532653f99410e1e524d8614cd7fb1479f5bc2c45372b80263b8406512c95a91d  demo/runner.ts
34c1a48a876da6bd0741930a2e942d753c016830fe51068523be8a33babb91ff  package.json
c429199889e6a38d501fd79fd58a2f7ffb844399de1c5f43acb09b74bdd1521f  README.md
608f9d0e23c51cdecc8d4daec00b32ea4ff7922511361afde6f63890b2d86cf0  src/common/plugin-entry.ts
bafb2717758d9105ce8dbd4d015b867c746b08c855c287b1561e840fa82f8a91  src/common/schema.ts
b20f94360471e2eaa43ea08a71f1ba12ccf9dd12babe10c5b8be62ec25f187e1  src/common/tool-shape.ts
a4b5fd7dcb88c304ac12d7cbbda86f36ca83d3246d405288b08ad4c5c22e3c4e  src/core/config.ts
45549660f6c9ccdc0318c83c4436be9dc899baba9a57ffcde4f93a663e2d7ac1  src/core/probe.ts
52bf7bd33950aa055da100b91f18fc2d5e9e2f2b595ddba3fdcd2985c817bb9a  src/core/router.ts
cf5ab3fecc2393f0222fbb3fca56519ac2eae1e5d9f067727dba34745c4ecda9  src/index.ts
27cb681c14401cf462b37c7bf44b41bd50de93518407776a16b12a8716e7b527  src/tools/bilibili.ts
72962155a581cc20fb14d720d811fcf884b09cfaa7a9c4b9280cad64cc57297f  src/tools/github.ts
52f8961f768264ce505c0ada4ffead2ffe235fa61427f9dc783c123527ac3b9a  src/tools/index.ts
54224ff5959df298213b1fe9e37f50016225e5426c648cc533aa85af398e24ec  src/tools/rss.ts
261ca3baeb7d05a6fed60016c0e49971e0894a31abc6a81410f5457073e7e253  src/tools/twitter.ts
b4cc8c228701e59d7ee370da8b5cf0f896d8e39b3e22435b422b7e22e73e2604  src/tools/v2ex.ts
d5ade356065f23278572508758b4b7b60dca955056a9a2b8e370114a56449db7  src/tools/web.ts
9e1679dc8e1b14927bd729553891719188a8ec77f82797858cb7e1a650037278  src/tools/xiaohongshu.ts
91a1a6adc093e2e21054d8c17a1202b50fa3b1229cbfe43021156777a5820b59  src/tools/xueqiu.ts
cdfdedf10a64dc9dfe1dba85748cb6d08d7a7e21b3b6ae56a6285790b94397e6  src/tools/youtube.ts
af4da590e0e72cc10025598704dec80922ba18bfa8b3b3103e941ac05d033f2b  src/types.ts
660540e6662d4c7eb4c324e84bfcd9505a1c692bbe3f48afbc7212b2e57572e2  tsconfig.json
```

## Adaptation Ledger

The verbatim import has no renamed or moved files and no intentional behavior
differences. Add every later rename, move, or intentional behavior difference
to this section in the same commit as the change.

- Characterization boundary: added Vitest coverage for imported registration,
  routing, backend selection, UTF-8 probe environment, RSS parsing,
  Xiaohongshu cleaners, and Xueqiu cookie parsing. Declared the previously
  used `tsx` development dependency and Node/DOM types for the package
  TypeScript boundary. No production behavior changed.

- Public plugin boundary: retained the imported `Schema`, tool helper, and
  plugin-entry import paths while delegating them to TypeBox and the public
  OpenClaw Plugin SDK. Registered tool instances now declare readonly risk,
  and the package has a formal manifest and workspace extension entry.

- Readonly configuration boundary: removed legacy home-directory JSON reads,
  directory creation, writes, and mutation methods. Configuration is now an
  immutable in-memory snapshot with explicit environment compatibility and
  configured/missing-only secret diagnostics.

- Runtime command boundary: replaced direct `execFile` calls with the public
  OpenClaw command runner and Windows spawn resolver. Commands now share
  bounded output, UTF-8 environment, timeout, cancellation, and argv-only
  execution while preserving the imported five-state probe classification.

- Guarded HTTP boundary: public reader HTTP helpers now use OpenClaw's
  SSRF-guarded fetch with pinned DNS, redirect revalidation, bounded response
  reads, timeout/cancellation, and dispatcher release. Jina keeps a 20 MiB
  text limit; other JSON/text responses default to 10 MiB.

- Authenticated reader configuration: Xueqiu consumes the resolved readonly
  cookie snapshot through its original cookie jar, and all Xueqiu requests
  now use the guarded HTTP boundary while retaining Set-Cookie renewal.
  Backend array overrides reorder only known imported backends and cannot
  hide unspecified or newly available candidates.

- Agent Browser fallback boundary: added the public runtime
  `agentBrowser.invoke` helper and an internal bridge that reuses the selected
  profile/auth state, closes temporary headless sessions, and retains visible
  login sessions. Web, Bilibili, YouTube, and GitHub can return browser page
  summaries after their original backends fail; Xueqiu may import filtered
  `.xueqiu.com` cookies into its in-memory jar only when `xq_a_token` exists.
  Twitter and Xiaohongshu return a login handoff instead of scraping DOM.
  Browser errors preserve the original backend diagnostic, and no cookie or
  token is included in tool results.

- Login handoff skill: registered a plugin-local skill that recognizes
  `browser_login_required`, continues with the returned visible profile and
  session, and retries the unchanged `retryTool` call after user login. The
  skill explicitly forbids reading or returning cookies, tokens, or browser
  storage.

- Media transcription boundary: retained YouTube's original yt-dlp download,
  ffmpeg compression, 24 MiB threshold, 600-second chunking, ordered
  concatenation, and temporary-workspace cleanup. Removed independent
  Groq/OpenAI keys, endpoints, provider fallback, and multipart requests;
  every chunk now uses the public OpenClaw
  `mediaUnderstanding.transcribeAudioFile` runtime and its configured
  provider credentials and policy. The legacy `provider` argument remains
  accepted for compatibility but cannot bypass runtime policy.

- Packaging and documentation: the imported package is now a formal
  `extensions/*` workspace member discovered and bundled by the existing
  OpenClaw extension pipeline. Replaced the upstream shadow README with
  runtime configuration, Browser policy, tool inventory, and security
  documentation; added project README and labeler coverage. No second reader
  implementation or source copy was introduced.

- Electron packaging coverage: added an Electron E2E contract that launches
  the built app and verifies the packaged Reach manifest, default startup,
  nine tool names, login-handoff skill, and absence of credential identifiers
  in rendered content.

- Security boundary coverage: added direct tests for strict versus
  official-host SSRF policy selection, guarded-resource release after parse or
  response-limit failures, private target rejection, and bounded command
  output. No production behavior changed.
