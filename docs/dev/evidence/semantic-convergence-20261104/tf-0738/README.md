# TF-0738 retained evidence

- driven_by: agent; actor: codex/prompt-budget.
- Clean tested candidate: 65b8be15bf37039d2a7c9089d81b86df45bc644b. All recorded source fingerprints stayed stable.
- Node behavior: 16/16. Full selected test inventory: 235 passed, 3 failed, 0 skipped / 238 total.
- 3 embedded failures reproduce with pre-change 7abbf58a3e1d4404f26076c54fd7ea00d75e26a3 runtime modules; baseline.config.ts and baseline-loader.json preserve the exact loader replay. They are existing residuals, not green tests.
- 8 observed API turns: accounted ratio 1.0, unbudgeted 0, unaccounted P95/P99 0. Missing-accounting control detects 20 characters.
- Managed limit remains 6000; post writes do not consume or widen it. Scoped typecheck/lint/comms pass; full typecheck retains 2 existing RSI errors.

observations.json contains actual budget/snapshot readings. commands.json contains commands, exits, timing, environment and baseline comparison. source-manifest.json binds code and unchanged failure sources. SHA256SUMS covers every retained file except itself.

The footprint is the system component and turn injection charges, not the complete provider request or token bill. No live-provider, packaged runtime, real-human, GA or default-on claim is made.
