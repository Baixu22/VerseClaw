# RSI reference-bound oracle cohort (v6)

- 24 calibrated tasks; 21 admitted and 3 rejected.
- Each task restores hidden oracle test files from its historical reference revision; root working-tree test drift is not used as oracle input.
- `tf-0278-s03`, `tf-0283-l01` and `tf-0285-l03` remain rejected because their baselines already pass; they need a rebased unresolved start, not a gate relaxation.
- The support package `markdown-it` resolved from the local pnpm store as 14.1.1 while the historical package declares 14.2.0; this mismatch is retained in `oracle-binding.v1.json`.
- 216 model slots remain not-run; the provider receipt is retained but not evaluated because task admission is incomplete.
- No benefit, model-quality, real-human, product-lock or release claim is made.
