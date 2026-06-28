# Boundary Proof

## Runtime Boundary

The accepted explicit pilot remains a pure helper:

- `formatTaskLoopContextPackForReviewer(...)` remains the default reviewer prompt formatter.
- `formatTaskLoopContextPackForReviewerPilot(...)` is a separate explicit helper.
- `assembleAgentMapPromptCandidateTaskLoopExplicitInvocationPilot(...)` requires all four gates, `explicitInvocation=true`, and an explicit valid `AgentMapResult`.
- Missing/invalid inputs, disabled gates, omitted invocation, budget exhaustion, empty candidates, and prompt-present files fail closed to legacy reviewer prompt bytes.

## Authority Boundary

Pilot results keep these authority flags false:

- `insertedIntoDefaultPrompt`
- `insertedIntoDefaultTaskLoopReviewerPrompt`
- `insertedIntoGateway`
- `insertedIntoModelMessages`
- `insertedIntoProviderTransport`
- `persisted`

Metadata keeps `noRuntimeAuthority`, `noToolAuthority`, `noGatewayCutover`, `noProviderTransportCutover`, `noModelMessageCutover`, and `noPersistence` true.

## Communication Boundary

This phase does not touch:

- Electron Main;
- Gateway;
- `src/lib/host-api.ts`;
- `src/lib/api-client.ts`;
- provider transport;
- runtime send/receive;
- channel delivery;
- fallback behavior;
- renderer IPC;
- renderer Gateway HTTP/WebSocket.

Therefore comms replay/compare are skipped with this explicit no-touch reason.

## Scan Summary

Required scans cover:

- AgentMap flag and pilot references in runtime/Gateway/Electron/renderer/shared paths;
- renderer direct IPC and direct Gateway calls;
- sentinel leakage;
- service/listener/daemon/database/WebSocket/HTTP server creation;
- mutation/apply/edit surfaces;
- prompt/model/Gateway/provider/default-on wording;
- persistence APIs;
- README translation sync.

Touched-file matches are expected Markdown/task/test proof text only unless otherwise noted in `synthesis.md`.
