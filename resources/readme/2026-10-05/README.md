# README visual sources — 2026-10-05

These are curated documentation assets, not release-acceptance evidence. All automation was `driven_by: agent`, `actor: codex-readme`. File hashes, source identities and validation results are in [manifest.json](manifest.json).

## Three kinds of image

| Files | Origin | What they show |
| --- | --- | --- |
| `en/*.png`, `zh/*.png` | Direct Playwright captures of the actual Windows Electron application | Chat, Knowledge, Task Ledger and provider configuration, in isolated profiles |
| `workflow.webp`, `knowledge.webp` | AI generation using `gpt-image-2.5` through the user-designated image service | Conceptual workflows, with the existing Verse Claw flame logo as the character reference |
| `architecture.svg`, `chat-sequence.svg` | Deterministically rendered from the adjacent `.mmd` files | Source-backed desktop/runtime ownership and the normal chat request/event path |

English and Chinese captures are separate runs. The Japanese and Russian READMEs use the English UI images and say so. Illustrations contain short Chinese labels; translated captions explain their meaning. No generated image is presented as an application screenshot.

## Screenshot conditions

- Application source version: `0.4.9-alpha.0`; base HEAD: `cafe03a5939beac5c3e4e47ef78e8d5f88f86386`, plus pre-existing working-tree changes. This is not a clean release candidate.
- Platform: Windows x64, light theme, a 1440 × 960 requested Electron content size. Exact captured dimensions are in the manifest.
- Driver: [`tests/e2e/readme-gallery.spec.ts`](../../../tests/e2e/readme-gallery.spec.ts), using the existing isolated-profile Electron fixture. E2E startup effects are minimized; the driver explicitly starts and waits for a real local Gateway. There are no IPC mocks, replay fixtures, invented messages or DOM replacements.
- The Knowledge run explicitly loads the source `memory-wiki` extension with a new isolated vault path. The screenshot shows its uninitialized/empty library, not an applied knowledge record.
- No provider credentials, paid model calls, private transcripts or user accounts are used for screenshots. Model configuration and task data are empty.
- Toasts are dismissed through their UI controls. The sidebar disk warning is retained because the capture machine actually has less than 10% free space on one volume. Nothing was painted out of the images.
- Provider history is allowed to finish loading before the final capture. Capturing an empty state does not validate a populated provider, channel, knowledge-application or task-execution path.

Reproduce locally after installing both workspaces and building fresh runtime/Electron bundles. In PowerShell:

```powershell
$env:CLAWX_README_CAPTURE_DIR = '.local/readme-capture'
pnpm exec playwright test tests/e2e/readme-gallery.spec.ts --reporter=json --output=.local/readme-playwright
```

Inspect the PNGs and JSON results before copying selected assets into a new dated folder. Keep raw transcripts, temporary profiles and failed captures local. The original capture receipts and discarded attempts for this run are under `.local/readme-20261005/` and are not source dependencies.

## Illustration provenance

Installed skill: [Ian Xiaohei Illustrations](https://github.com/helloianneo/ian-xiaohei-illustrations), revision `4102eb807f03bcb6e538a16e8b31b41db8b5b954`, MIT licensed. Its hand-drawn editorial composition guidance was used; the user explicitly requested the project's own character instead of Xiaohei. No upstream example artwork was copied into this asset set.

The reference is [`src/assets/logo.png`](../../../src/assets/logo.png), placed on a white 1536 × 864 reference canvas without changing the logo. The first API output inherited the small original logo dimensions and was discarded. Final images were generated again from the wide canvas, visually reviewed, then resized to 1600 × 900 and encoded as WebP for README loading. The original generated PNGs remain local.

Exact prompts: [workspace workflow](prompts/workflow.txt) and [knowledge workflow](prompts/knowledge.txt). The flame character preserves the logo's recognizable orange silhouette and yellow face while performing each workflow action. These illustrations explain concepts; they are not execution traces or claims of successful verification. API credentials were supplied only in process memory and are absent from source, prompts and manifests.

## Mermaid maintenance

Edit the `.mmd` files first. This run used the already available `beautiful-mermaid` 1.1.3 renderer (`renderMermaidSVG`) with white background, `#24272e` text, `#e87935` accent and Segoe UI. The PNG previews used for visual inspection are local; the small SVGs remain crisp in GitHub and other Markdown viewers. No new project dependency was added.

The [architecture guide](../../../docs/architecture-overview.md) also contains a native Mermaid sequence block and a static SVG fallback. Keep that block equal to `chat-sequence.mmd`. Source hashes in the manifest allow a later update to detect drift; they do not certify all implementation behavior.

## Later brand update

On 2026-10-06 the owner selected B2. The current `src/assets/logo.png` now uses B2; the original reference for these illustrations is that path at commit `55a33921e`. These dated captures and generated illustrations remain unchanged. Their manifest describes the capture-time assets, not the later brand update.
