---
id: rsi-campaign-budget-boundary
title: RSI whole-campaign resource and billing accounting
type: ai-coding-rule
severity: error
appliesTo:
  - scripts/rsi-paired-measurement.*
  - scripts/lib/rsi-campaign-budget.*
  - scripts/rsi-coding-collector.*
  - scripts/lib/rsi-coding-tool-loop.*
---

An RSI measurement with a campaign budget binds its authorization and billing
basis before dispatch. Preflight, task requests and continuations share one
durable ledger. A reservation precedes the network request; missing terminal
usage retains the upper token and spending reservation, including after restart.
The same request identity cannot be dispatched again.

Currency amounts use the declared currency. Provider credits, tokens and fiat
amounts remain separate fields. Existing Free quota may be consumed only while
the declared provider/model and Free route are verified. It authorizes no quota
purchase or paid fallback. A fiat token tariff requires explicit price evidence.

Replay joins ledger entries to raw preflight/trial Responses receipts, checks
identity and usage, and reports both settled consumption and unknown reserves.
Campaign accounting cannot change the frozen collector, task corpus, oracle,
candidate, historical verdict or product defaults.
