# TF-0390 Final Evidence and Boundary Report

Generated: 2026-10-18T12:01:43.648Z

## Candidate

- `78f16bd5d` (clean candidate; source commit before this evidence-only correction)
- All receipts are `driven_by: agent`.

## Engineering evidence

- Workbench evidence is generated for 15 scenarios; scenario recordings are present.
- Full deep-test ran with a fresh build, full typecheck and full Agent Dev E2E; functional result `success=true`.
- Full Agent Dev E2E passed 4/4.
- Typecheck 36896ms and full Agent Dev E2E 30663ms were over target but under their hard limits in the latest full run.

## Audit truth

The latest audit is **fail** (grade B, score 80/100, maturity blocked); it is not called green.

- Fresh `e2e-build` took 83583ms, exceeding the 58000ms hard limit by 25583ms.
- The audit exit code is 1 because of the hard performance veto, not because a functional test failed.
- Build budgeting was not relaxed and no frozen default was changed.
- The run is full-gate-complete and release-ready=false.

## Release boundary

- No current release/ installer exists for this candidate.
- NSIS installer success is **unproven**; no executable/installer claim is made.
- No publishing, tag, public-repo change, product lock or frozen-default change is included.

## Deliberate exclusions

- Full OS sandbox.
- Manus cloud VM, Website Builder, realtime collaboration.
- A second trace, task or goal authority.
