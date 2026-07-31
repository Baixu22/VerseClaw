# FP-P4-05 C1 authoritative gate decision

- Gate authority: `coding-c1-hand-authored-real-tools`
- Authoritative reduction: **4.500x**
- Threshold: **5x**
- Gate result: **fail**
- Recommendation: **keep-off**

## Corpus decision

The four hand-authored fixtures are authoritative because their on-arm executes
the real context view tools. The 32-task deterministic synthetic corpus remains
a scale and routing reference only; its **5.125x**
result cannot supersede real-tool execution evidence.

## Product boundary

The authoritative result is below the unchanged 5x threshold. Context view
tools remain default-off. `liveReady=false`, `productApproved=false`, and
`defaultOn=false`. This decision does not unblock TF-0006 or authorize GA.
