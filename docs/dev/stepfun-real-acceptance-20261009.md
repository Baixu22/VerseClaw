# StepFun real-model acceptance — 2026-10-09

## Authorized scope

The owner explicitly requested continued real-model acceptance using the previously
supplied Step Plan endpoint and step-5-preview. This run uses the existing script,
real HTTPS model responses and a real isolated Runtime Gateway. It does not use
synthetic network responses, computer-use, another model, or a product-default change.

The bounded scenario consists of live streaming, real model function selection and
agent-driven fixture result consumption, two Gateway context turns, then one actual
Runtime read tool on a newly generated random file. These tool scenarios are reported
separately: a synthetic fixture lookup is not Runtime filesystem execution.

Only explicit LIVE_MODEL_RUNTIME_READ=1 permits the read tool in this isolated test
configuration, restricted to its workspace. Default runner tool policy stays deny-all.
At most 8 provider calls, at most 3 Gateway user turns, max output 512 direct / 1024
Runtime, no automatic retry. The real credential enters via stdin only; Runtime
receives synthetic relay auth and the loopback relay supplies provider auth.

## Candidate and evidence

Acceptance is pending until the original report, session histories, transcript,
usage, exact-secret scan and independent process checks are read from disk.
Raw receipts will be stored in D:/ClawX-work/stepfun-real-acceptance-20261009/.
The previously built Runtime assets are identity-checked before reuse; this is not
a fresh install or build qualification. Old failures and accepted reports are preserved.

This bounded real-model evidence cannot establish broad quality, all tool permissions,
desktop/platform release readiness or default-on graduation. Monetary fees are unknown;
usage cost zero defaults must not be treated as a free provider call.
