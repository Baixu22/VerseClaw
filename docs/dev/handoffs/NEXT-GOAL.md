# Next Goal - Human Canary Boundary

Workspace: `C:\Users\27933\Desktop\clawx\ClawX`

## First checks

```powershell
git status --short --branch
Get-Content -Raw docs/dev/first-product-controlled-preview/STATUS.md
Get-Content -Raw artifacts/first-product-preview/FP-P2-01/canary-charter.template.md
```

## Goal

`FP-P2-01` is blocked on human inputs. Obtain the independent FP-P1-07/08 acceptance and a complete, signed canary charter. Then execute `FP-P2-02` as ten genuine human product tasks on one fixed clean build, followed by data-driven `FP-P2-04` and the four-surface `FP-P2-03` decision.

## Hard bounds

- Engineering templates are not acceptance evidence or canary runs.
- Use no real credentials or remote side effects before the charter names the sandbox/disposable repository and allowed actions.
- `liveReady=false`, `productApproved=false`, and `defaultOn=false` remain fixed.
- Do not change the 6000/0.1 injection settings before FP-P2-02 produces the required real distribution.
- Do not apply Task Forest state without a new FP-P2-03 proposal and explicit user confirmation.
- Do not stage, commit, push, or open a PR without explicit authorization.
