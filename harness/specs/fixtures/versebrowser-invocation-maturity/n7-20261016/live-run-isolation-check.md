# Live run endpoint attribution check (N7)

Observation A: the in-test protocol stub logs every incoming request; it received ZERO requests in two runs (stub-key and a real-looking key).
Observation B: the verse-claw-e2e-run-* directories contain only the worker jsonl, and no verse-claw-e2e-home-*/user-data-* directories remain under D:/tmp after the runs.

Interpretation (corrected): tests/e2e/fixtures/electron.ts DOES isolate the profile - it mkdtemps a separate verse-claw-e2e-home-* and a separate user-data dir, and cleans them up
after the run. Observation B is therefore expected and does NOT prove that the machine profile was used. The earlier note claiming 'does not isolate' was wrong and is superseded by this file.

What remains true: the injected endpoint was not reached by the app in those runs (Observation A). Attribution of the empty tool arguments to either the model or the runtime is
therefore still open, and this hypothesis (machine profile vs injected endpoint) is NOT confirmed either way.

To settle it, instrument one of:
- the runtime's provider resolution (which base URL it actually uses for the model call), or
- the app's provider-sync path (does providers.createAccount reach ~/.openclaw/openclaw.json in the isolated home?).
