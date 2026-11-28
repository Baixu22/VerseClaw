# E5 Native Static Review

Reviewer model: ccs-ai/gpt-6.1-sol  
Review date: 2026-11-28  
Result: patch is incorrect; one actionable evidence-integrity finding.

## Reviewed candidate and files

C checkout: D:/tmp/session-collaboration-mainline-20261126/C/source  
HEAD: 25118d45eb3bdedefbbe45f8250cec7a2e735b41  
Index tree: 8b343cc72d36aaaf6909a974879d97d5a3548a8e

The E5 draft tests/e2e/session-collaboration-center.spec.ts is 159 lines, SHA-256 32B6617DD609F6C3FC78CC93B634EF3286A6076BEADC69F4A85802FC3B8EAFBA.

The six-file staged diff was reviewed. SHA-256 values:

- harness/specs/tasks/session-collaboration-e5.md — 26FB4678246A9F20DE62CD2619E751DDCCF4B6B807BAEF436C3FF98AC0AD9FF2
- harness/specs/scenarios/session-collaboration-center.md — 133406DBAA7ED79007FB3DB963AAA8D384534F067E7B9C9665D031996EBA70D0
- docs/modules/sessions.md — CC73551F5D5D27F4E172E037F801481EF57EBD3F5C64B18E7B0762DADEB05204
- docs/modules/multi-agent-and-tasks.md — E23D94F2B66D940AECE1023773BC409C8DFBBF6DD6E371918199CC1BFC313F27
- docs/modules/resources-and-observability.md — 0E6966BB753826E9EDEF8451BDEB38CA4A65DE8D0FD486A457C00100448301F4
- tests/e2e/session-collaboration-center.spec.ts — 32B6617DD609F6C3FC78CC93B634EF3286A6076BEADC69F4A85802FC3B8EAFBA

E implementation reference: D:/tmp/session-collaboration-mainline-20261126/E/source  
HEAD: 25118d45eb3bdedefbbe45f8250cec7a2e735b41  
Index tree: c4fb62bdaa9feddf108084be47529cec0ad496df

Current reference-source SHA-256 values:

- src/stores/session-collaboration.ts — 2A185642D313B5ECEE83207E6375DA1D75B52AEFE96C36DA559B4F302EFFF285
- src/components/agents/SessionCollaborationPanel.tsx — 57DCB7A788632EE825C0F32EF66AB425A904FF44A4D10328F49A473060D28739
- src/components/agents/SessionCollaborationMessages.tsx — 6E8688DD0B6A5BF2DE5A1EA0F95769963C95043B0A99F2C876523BA67E65BB0D
- electron/services/workspaces-api.ts — 884F71F5213981DCBF91E1F8A4F4EEE32E34EC4807C8A8D3FA70396AB3826FCF
- electron/services/sessions-api.ts — D3224ADA9C00FCB2256E13D357CA6D6959DFE08AB7EA74A855C2FBCD4907E3A7
- electron/services/session-activity-api.ts — BC4B4BB284CAADFA5DE0B995D4A53BCA25047CBD9E13C6E2C152430A86EDB6A6
- openclaw_runtime/src/gateway/server-methods/session-collaboration-usage.ts — 3F1EFAB19F99A0EFABFF785E22D986BAE13C29895454C66BE331ED2635ACB771
- openclaw_runtime/src/gateway/server-methods/session-collaboration-resources.ts — 1602378F8B9A46CE427A54502ADC73B002E70D6F1B1F3C4691BD904DE0245716
- shared/host-api/contract.ts — B385700DF7D9C795619B77899B7BD5E135E151F3AC8806AB9AE09426504D8FAF
- shared/session-collaboration-message.ts — F1E83E1C34685C0895A84AB3F2EAD24AC3ED08660989C72C56AE36F6F4001EDA
- shared/types/session-collaboration-message.ts — 14A5837558B79BA484A4AF27DED5CBB1F334E7A1C530EA8B31ACB9BD8CFBEB6F
- shared/types/session-collaboration-watch.ts — C696E710D5FC5E432A16BD94425120D183FFF3C3930BA00869A040D244E280E1
- shared/types/session-collaboration-usage.ts — 8C4CBD50D8D8AFE4FB62D597BAA7B1649212D02BB5C08443BBEE0A5498F4BBD6
- shared/types/session-collaboration-resources.ts — 5502AEECDCF0805B13C7D02DE5B577EF22E735E86F00086F4502A4A76FEFD222

## Finding

At tests/e2e/session-collaboration-center.spec.ts:147-158, the test assigns status passed and writes the evidence before teardown. It then ignores closeElectronApp's returned process-exit/error report and awaits provider.close. If Electron shutdown is incomplete, or provider.close rejects after the file was written, the artifact can still say passed while the test run fails or cleanup remains incomplete. Determine and record teardown outcomes before writing the final status, while ensuring each cleanup step still runs.

The prior message-source gap is resolved in the current draft: lines 70-71 assert actor operator and sourceRun null, and line 96 confirms the persisted receipt carries the original message.

The Host call shapes and the documented behavior align with the E implementation. The UI check covers same-window page reload plus Gateway restart, as scoped. Material use is tied to the target run, reader, source and digest; usage and resources use the original scopes; reset makes the old-scope resource read stale.

Static review only. No tests were run, and this review does not establish full Electron execution, CI, A5/D4 measurement, or product acceptance.

