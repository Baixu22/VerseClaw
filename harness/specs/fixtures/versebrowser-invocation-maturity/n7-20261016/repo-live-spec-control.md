# Control experiment: the repo's own live-model spec (N7)

Ran tests/e2e/chat-cache-live-model.spec.ts (the repository's own live-model E2E) against the same resident endpoint:
  CLAWX_LIVE_MODEL_E2E=1 CLAWX_LIVE_PROVIDER=custom CLAWX_LIVE_BASE_URL=http://127.0.0.1:3065/v1
  CLAWX_LIVE_MODEL_ID=glm-5.3-flash CLAWX_LIVE_MODEL_REF=custom/glm-5.3-flash CLAWX_LIVE_TURNS=1

Result: FAIL - assistantMessageCount stayed 0 for the full 180s poll, i.e. no model turn was produced.

Interpretation: this is not specific to the N7 spec. In this checkout, injecting a custom provider account through the host API does not make the runtime use that
endpoint, so the repository's own live E2E cannot produce a model turn either. Any apparent live-model output on this machine therefore comes from the machine's own
configured provider, not from an injected endpoint.

Consequences for N7:
- the live leg is blocked by a repo-wide provider-injection gap (a real defect worth fixing on its own),
- no live run on this machine can currently be attributed to an injected endpoint, so the requestId/session/owner/event correlation cannot be asserted this way yet.
