# RC-03 seal coverage

RC-03 uses the existing seal registry to admit semantic producers before sealing
and permit transport transforms afterwards. `getSealCoverageMatrix()` returns
immutable rows from those same registration facts; it is not a second registry.

The default remains off. Explicit `OPENCLAW_RC03_SEAL=1` or
`runtime.rc03.seal=true` enables admission, and the enhancement kill switch wins.
Unknown applied producers and a system-prompt change after sealing reject before
the embedded provider function executes. Receipt persistence remains observational:
a write failure is reported separately and does not become a successful receipt.

| Producer | Mutates | Phase | Production entry |
|---|---|---|---|
| compass-ssp | system_prompt | pre-seal | COMPASS pre-reply / candidate projection |
| compass-retrieval | system_prompt | pre-seal | COMPASS retrieval projection |
| cvk-message-replacement | messages | pre-seal | Selected ContextEngine assembled history |
| cvk-system-prompt-addition | system_prompt | pre-seal | Selected ContextEngine system addition |
| dcs-knowledge | messages | pre-seal | Assembler/chat knowledge candidates |
| dcs-working-memory | messages | pre-seal | Assembler working-memory candidates |
| dcs-tool-registry | messages | pre-seal | Assembler tool-list data, not executable tool schemas |
| role-memory-injection | messages | pre-seal | Role-memory Assembler projection |
| vtoken-packer | system_prompt | pre-seal | VToken Context Orchestrator stage |
| memory-pilot-injection | system_prompt | pre-seal | Runtime Memory pilot projection |
| session-start-injection | system_prompt | pre-seal | Session-start candidate projection |
| role-spawn-memory-pack | system_prompt | pre-seal | Role-spawn prompt contribution |
| embedded-system-prompt | system_prompt | pre-seal | Attempt builder, provider transform and pre-loop hook writes |
| compaction-summarizer | messages | pre-seal | Summarizer messages and system prompt sealed at the stream boundary |
| btw-side-question | system_prompt | pre-seal | BTW prompt and sanitized side-question context |
| transport-provider-headers | transport | post-seal | Provider headers |
| transport-wire-serialization | transport | post-seal | Final request serialization |
| transport-cache-boundary-strip | transport | post-seal | Existing cache-marker removal |

Canonical `context-block:<source_system>:<block_type>`, Runtime Memory provider
suffixes and session-start suffixes resolve to their registered owners. A declared
custom producer uses the same registry and is included in the plan. Unrecognized
positive lineage reaches admission and rejects; explicit ids cannot hide it.
Registration copies and plan readbacks cannot mutate their stored counterparts.

Model-call identities are shared by the context producer and compaction boundary.
A summary consumes its own index; the next context callback advances past it.
Denied stream invocations do not advance into an unsealed gap. Each stream call
checks the current enhancement kill switch; a killed/off finalization clears the
run's retained plans and restores the legacy path, including summarization.
Creation and enforcement resolve the same current configuration. Historical turn
kill lineage is not used as the current decision after release. A context callback
reads the real session prompt, including continuations without `before_agent_start`.
The effective prompt is always bound, even when the explicit argument is omitted.
Explicit summary identities are reused on wire retries or rejected on conflict.
End-of-run cleanup releases call counters; temporary disabling only clears plans.

BTW seals its own prompt/context under an ephemeral run identity and releases it
after streaming. Standalone manual compaction uses its session identity when no run
is supplied, and releases owned state when it finishes.

`Rc03SealHookResult.sealCoverage` is `disabled` or `enforced`. The same field on
`ContextFinalSnapshot` distinguishes optional RC-03 enforcement from the snapshot's
flag-independent immutable finalization. The plan's post-seal ids are the allowed
transport transforms, not a record that every transform executed on every request.

Run `tests/unit/rc03-seal-coverage.test.ts` and the runtime `rc03-seal.test.ts` /
`rc03-seal-wiring.test.ts` through the existing Node test entry points. The matrix
test writes actual API decisions when `RC03_COVERAGE_TRACE_PATH` is supplied.
Three negative classes cover unknown prompt producers, post-seal semantic use
and duplicate registration, alongside legal continuation and default-off behavior.

This is agent-driven registry and embedded stream proof. It does not authenticate
malicious in-process plugins or prove every provider adapter's final serialized
message/tool representation. Existing Stage 1/2 envelopes and the later joint
verification node own those wire claims. No release/GA or default-on claim follows.
