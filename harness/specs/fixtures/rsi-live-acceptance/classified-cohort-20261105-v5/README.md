# RSI classified cohort readback (v5)

- 24 calibrated tasks; 11 admitted and 13 rejected.
- Admission remains `NO_GO`; 216 model slots stay not-run.
- Reference failure classes: 3 assertion, 6 infrastructure, 0 target-module-absent, 1 oracle-input-drift.
- Three tasks have a baseline that already passes; `tf-0297-a05` also has a baseline infrastructure failure.
- The v5 run includes fresh admission reports for all 24 tasks; local workspaces are not retained in this package.
- Timeout and ENOSPC retry attempts, including the agent-driven 300-second reruns, are disclosed in `attempts.v1.json`; no retry is hidden as a first-attempt result.
- The provider preflight is retained but not evaluated because task admission is incomplete.
- No model trial, quality/benefit claim, product-lock change or real-human evidence is present.
