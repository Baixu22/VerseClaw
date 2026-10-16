# Live run isolation check (N7)

Observation: the verse-claw-e2e-run-* directories produced by the live chain spec contain only the worker jsonl - no home or user-data children.
By contrast, the earlier baseline probes (which pass an explicit frozen toolchain and their own isolated home) DO create home and user-data under their run root.

Conclusion: the live chain spec (using the shared launchElectronApp fixture with skipSetup) does NOT isolate the app profile, so the app reads the machine's real
provider store. That is why the in-test protocol stub received zero requests while a real model still answered and emitted an agent_browser tool call: the call went to
the machine's own configured provider, not to the injected endpoint.

Consequences:
- the earlier empty-arguments observation cannot be attributed to the injected endpoint from the E2E;
- it DOES mean a real provider-backed model called agent_browser through the runtime and the runtime recorded the call with empty arguments - a signal that needs
  runtime-side instrumentation (model emitted empty args vs runtime dropped them) before it can be called a ClawX defect;
- the direct call to 127.0.0.1:3065 remains the only evidence about that endpoint, and there the argument string was malformed (missing its opening brace).
