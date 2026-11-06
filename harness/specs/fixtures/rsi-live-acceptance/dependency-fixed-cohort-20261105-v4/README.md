# RSI dependency-fixed cohort readback

This readback isolates the grader dependency-link repair.

- 24 calibrated tasks; 11 admitted and 13 rejected.
- The repair added a runtime-dependency fallback and root/runtime linking; dependency-only reference failures were re-run.
- 216 model slots remain not-run.
- `tf-0283-l01` and `tf-0285-l03` remain rejected because their baselines already pass; the other rejected tasks still fail their current frozen oracle.
- No provider task trial, benefit claim, product-lock change or real-human evidence is present.
