# TF-0778 STS selection evaluation

This fixture binds the `CodingStsSelection/v1` report to the current Windows candidate. The evaluator used an independently built VG binary, a clean installed STS wheel, the native STS test suite, nine targeted hazard cases, and 40 real-project trials. All generated artifacts are marked agent-driven; no human evidence is claimed.

The measured benchmark scope for each project is its declared synthetic candidate test file. Both projects produced `collected=1` and `selected=1`; the selected arm includes the mandatory final full verification. The observed cost therefore shows no speed benefit. The accepted conclusion is `improvement-unproven`: selection remains opt-in and no default, release, GA, or benefit claim is made.

Key results:

- Native STS: 503 passed, 1 skipped; contract manifest and historical audits passed.
- Clean wheel: 1.1 and 2.0 request/plan/result/consume and VG host loops passed; 2.0 has four negative controls.
- Hazard cases: missed failure, zero selection, collection failure, nodeid drift, dynamic parameters, conftest/plugin change, flaky, timeout, and environment drift were each handled with its declared result.
- Real project pairs: httpx and packaging each include five cold and five warm repeats for both selected and full arms.
- Independent verifier: `ok=true`, `acceptanceEligible=true`; all seven structural or digest tamper cases were rejected.

The report contains command argv, exit codes, output hashes, compressed raw trial reports, total wall time, peak process-tree RSS, counts, and cleanup results. `SHA256SUMS` covers the retained evidence set.
