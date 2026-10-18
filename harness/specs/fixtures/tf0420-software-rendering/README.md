# TF-0420 Software-Rendering A/B

This fixture keeps the static layer audit and the GPU-disabled Electron A/B
probe for composer, sidebar, session-search dialog and settings.

The probe measures real renderer frame cadence, long tasks, sampler/RSS values,
and writes before/after screenshots. It injects a runtime override that disables
all backdrop filters and will-change hints; no production CSS is changed by the
override.

Run:

```powershell
$env:ELECTRON_DISABLE_SANDBOX='1'
node harness/specs/fixtures/tf0420-software-rendering/measure.mjs <worktree-root> harness/specs/fixtures/tf0420-software-rendering/ab.json D:	mp	f0420-ab
```
