# Knowledge assistant character

The Knowledge corner character opens a compact nonmodal floating conversation
with the current document, unsaved text and selected source set. The existing
KnowledgeChat component is embedded; the standalone `?knowledge=ask` route is
still available to existing Chat callers. The Library remains mounted and usable.
The floating window is at most 400 by 520 pixels, closes on Escape and retains
the thread and unsent input when closed. In-flight requests finish and checkpoint.
The floating window has no visible brand header, title or status banner. Its
compact toolbar contains an options menu and a round minimize control. Clear is
inside options; the character belongs to the answer and pending-work indicator.
Accessible dialog naming remains.

The floating surface stays 40px from the right and bottom window edges, inset
from the Library card's boundary. Its neutral material, hairline and shadow come
from shared tokens. The 32px minimize control has a subtle round surface and
means return to the assistant, preserving content. Outer radius (20px), input
radius (14px) and symmetric 16px input insets separate the two surfaces.

Compact replies hide role/time chrome and checkpoint timestamps. Source titles
remain visible as small references with paths in their title/accessibility text;
retrieval diagnostics and candidate operations share one Details disclosure.
Suggested questions live in the composer menu rather than a standing chip row.
For the exact local retrieval template, its fixed introduction and write-boundary
paragraph move into Details. The persisted/copyable answer and provider prose
remain intact; this only changes the compact presentation.

The panel opens in 180ms and minimizes in 140ms using opacity and a short
translation. It remains mounted through the outgoing transition and becomes
inert immediately; only completion restores the launcher and focus. A ticket
guards old callbacks when a transition is interrupted. Reduced motion uses an
80ms opacity-only transition; pending work and unsent input survive minimization.

Pointer drag stays within 112 pixels of the lower-right dock, with an 18-pixel
elastic edge. Release outside the radius returns to the dock with a brief
compositor animation (instant under reduced motion). An in-range position is
optional local UI state. A six-pixel threshold separates drag from click;
cancellation restores the start, and Enter/Space activate the native button.

The orange Ginger character is the approved closed solid from the local
`grokbot-animation-anatomy-main` showcase, approved in chat
`01a15ee0-e9ee-78b2-bdb6-c338cd0eac2e`. Four vendored inputs are bundled by Vite:
`bot-shape.js`, `solid-geometry.js`, `grok-player.js` and `grok-recipes.json`.
The source README declares MIT; original comments and extracted-recipe provenance
are preserved. No remote download, CDN, WebGL or new dependency is needed at runtime.

`KnowledgeBot` adapts the native state API and renders its procedural SVG.
It runs at a maximum 30 fps, suspends when hidden/offscreen, cleans up observers,
listeners and frames on unmount, and settles historical replies and reduced
motion to one pose. The static fallback uses the same approved front radii.
Host changes to the vendor are limited to hidden-document suspension and keeping
the requested state during static settling.

| Observed event | Character state |
| --- | --- |
| Idle / composer focus | idle / listening |
| `knowledge.search` pending | searching |
| Selected page reads pending | reading |
| Synchronous grounded answer construction | thinking (may complete in the same render) |
| `answerFromSourceSet` pending | waiting |
| Draft / inbox candidate creation | writing |
| Steward review pending | working |
| Answer ready / no sources / request error | finished / confused / failed |
| Hover / pointer drag | curious / dragging |

These are actual call boundaries in `KnowledgeChat`, not sentiment inference,
private reasoning or invented tools. The existing knowledge answers return as a
complete response. No tokens are synthetically streamed. A short completion
gesture settles to idle; errors remain until retry/dismissal or a new action.
Historical replies do not run independent looping animations.

`AssistantMarkdown` is extracted unchanged from the main `ChatMessage` renderer:
both surfaces use the same Markdown, math, tables, code headers and copy action.
The bounded knowledge composer uses the existing `codex-composer-shell` material
and geometry rather than loading the main composer's unrelated model, attachment,
workspace and runtime controls. Citations, retrieval diagnostics, checkpoint v1,
explicit draft creation and review remain on the existing Knowledge Host API.
Lucide and assistant-ui modules each have a dedicated production chunk: their
eager icon/resource registrations otherwise produce a temporal-dead-zone error
after Markdown gains a second consumer. Real built Electron startup covers this.

Automated validation and curated screenshots are under
`docs/dev/evidence/knowledge-bot/`. Evidence is agent driven; Electron tests use
controlled host responses to hold request boundaries and exercise retry. They
do not claim a live model run or real-human evidence.
