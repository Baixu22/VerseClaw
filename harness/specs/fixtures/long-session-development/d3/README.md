# D3 continuity-strategy decision evidence

Source candidate: 56cb9ba1ee819fb053c13974026f5bfea5149e3f (branch codex/long-session-implementation-20261023-r2, tree c885fdd32186598ddcceaeac9f9766c3b1b8fba8).
Decision: keep-baseline - no authorized live-provider sample: quality, cost and P95 gates are unmeasured or vetoed, so no strategy may be promoted

- continuity-strategy-decision.json: renders the decision after reading the frozen D2 artifacts from disk, lists the three candidate options with the evidence that selects and rejects each, records the D2 checksum verification, and asserts that no frozen product default or historical TF-0424 verdict moved.
- promotion-or-retention-boundary.json: the promotion/retention boundary: what stays un-authorized, the preconditions any future promotion must satisfy, and the rollback/failure fallback that would apply if a strategy were ever adopted by a separate spec.
- verification-receipt.json: D2 evidence readback, gate receipt, negative-case counts and cleanup.

D3 decides only. It activates nothing, wires nothing and flips no default; the continuity loop keeps the existing manual/native compaction path.

All actions are agent-driven (driven_by: agent, actor: codex-long-session-d3). No real-human verdict or data is claimed,
and no simulated or structural measurement is presented as a quality or cost win.
