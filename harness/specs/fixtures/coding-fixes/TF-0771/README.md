# TF-0771 CodingRun v1 integrity

Agent-driven only. Read acceptance.json for scope, gates.json for every exit/timing, and cli/cli-results.json for 17 actual CLI invocations and their input files.

110 contract/UI projection tests; two selected production Task Loop controller cases (67 other cases excluded); 103 tracked-source projection tests; two built Electron UI exports with real subprocess CLI and screenshots. The UI uses injected host RPC and makes no live-model or Task Ledger completion claim.

before-unit.json preserves six failures from the original candidate. Historical failed builds remain recorded; they are not final passes. SHA256SUMS covers every retained file other than itself.
