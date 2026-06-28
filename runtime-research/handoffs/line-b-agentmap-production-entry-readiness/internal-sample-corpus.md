# Internal Sample Corpus

The corpus defines 30 realistic internal task shapes. Samples are designed for replay or simulated replay evidence. Each sample expects candidate text to stay out of default prompts/model/Gateway/provider/checkpoint/lifecycle payloads and expects rollback to legacy reviewer prompt byte parity.

| ID | Task shape | Coverage | Expected candidate relevance | Expected no-leakage boundary | Expected rollback path |
|---|---|---|---|---|---|
| PE-01 | Small runtime helper fix with one touched file | successful | Identifies the helper and direct tests | Candidate only in explicit pilot surface | Disable TaskLoop explicit pilot |
| PE-02 | Renderer bug triage with host-api boundary | successful, multi-file | Highlights renderer/host-api boundary files | No renderer direct IPC/Gateway payload | Disable prompt assembly |
| PE-03 | Main process IPC review | multi-file, provider-sensitive | Points to Main-owned transport evidence | No model/provider transport insertion | Disable runtime shadow |
| PE-04 | TaskLoop self-check repair | successful | Points to context pack and self-check files | No default reviewer drift | Disable controlled cutover |
| PE-05 | Failed unit test repair | failed | Identifies failing test and nearest runtime file | No default prompt/model leakage | explicitInvocation=false |
| PE-06 | Blocked external credential task | blocked | Candidate is low authority and diagnostic only | No approval/security authority | Missing result |
| PE-07 | Long-context replay with large evidence | long-context | Keeps high-signal symbols only | No lifecycle/checkpoint leakage | Budget exhausted |
| PE-08 | Multi-file chat dispatch path | multi-file | Captures shared types, host-api, runtime dispatch | No Gateway request leakage | Disable any gate |
| PE-09 | Large candidate result | large-candidate | Fails closed rather than truncate | No silent partial insertion | Budget exhausted |
| PE-10 | Budget-exhausted AgentMap candidate | budget-exhausted | No candidate insertion | No candidate in reviewer/model/Gateway | Budget exhausted |
| PE-11 | Prompt-present active file | prompt-present | Excludes prompt-present file | No duplicate prompt-present content | Disable explicit pilot |
| PE-12 | Invalid AgentMapResult object | invalid-result | No candidate relevance accepted | No candidate in any payload | Invalid result fail closed |
| PE-13 | Missing AgentMapResult | invalid-result | No candidate relevance accepted | No automatic discovery/build | Missing result fail closed |
| PE-14 | All gates omitted | gate rollback | None; legacy behavior only | No candidate anywhere | Gate disabled |
| PE-15 | Only promptAssemblyExperiment true | gate rollback | None; legacy behavior only | No candidate anywhere | Gate disabled |
| PE-16 | Runtime shadow gate closed | gate rollback | None; legacy behavior only | No candidate anywhere | Gate disabled |
| PE-17 | Controlled cutover gate closed | gate rollback | None; legacy behavior only | No candidate anywhere | Gate disabled |
| PE-18 | TaskLoop explicit gate closed | gate rollback | None; legacy behavior only | No candidate anywhere | Gate disabled |
| PE-19 | Provider ordering sensitive registry run | provider-ordering-sensitive | AgentMap provider absent by default | Default provider order unchanged | Omit provider injection |
| PE-20 | Explicit injected AgentMap provider run | provider-ordering-sensitive | Runs only when explicitly injected and flagged | Default provider order still unchanged | Remove extra provider |
| PE-21 | Lifecycle event emission sample | lifecycle-checkpoint-sensitive | Shadow report hash/count metadata only | No sentinel in lifecycle events | Disable runtime shadow |
| PE-22 | Checkpoint persistence sample | lifecycle-checkpoint-sensitive | Checkpoint may record metadata only | No candidate text in checkpoint | Disable all gates |
| PE-23 | Windows prompt-present path normalization | prompt-present | Excludes normalized Windows path | No duplicate active file content | explicitInvocation=false |
| PE-24 | POSIX prompt-present path normalization | prompt-present | Excludes normalized POSIX path | No duplicate active file content | explicitInvocation=false |
| PE-25 | Empty AgentMap candidate | failed | Fails closed with empty status | No candidate insertion | Empty candidate fail closed |
| PE-26 | Runtime shadow diagnostics sample | successful | Measures hash/length/counts only | No candidate text retained | Disable runtime shadow |
| PE-27 | Production-entry sentinel fail-closed sample | leakage | Sentinel absent from fail-closed payloads | No sentinel in diagnostics/candidate fields | Gate disabled |
| PE-28 | Candidate sentinel runtime shadow sample | leakage | Sentinel hash only | No sentinel in shadow report text fields | Disable runtime shadow |
| PE-29 | Default-on wording scan sample | default-on blocker | N/A; documentation only | No approval of default-on/cutover | Block default-on spec |
| PE-30 | Comms-boundary sample | comms boundary | No comms path touched by docs/test package | No direct IPC/Gateway call | Skip comms with reason |
