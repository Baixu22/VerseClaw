# Full RSI task admission batch

This is the 2026-11-05 second full-cohort calibration readback.

- 24 tasks calibrated; 6 admitted, 18 rejected.
- 216 model slots remain not-run because the cohort did not satisfy the hard admission gate.
- 16 tasks have a reference oracle not passing under the current frozen oracle.
- 2 tasks have a baseline that already passes.
- 5 rejected tasks also have no gradeable baseline failure; remaining reasons are retained in `result.v1.json` and `admission-report.json`.
- No provider task trial, quality measurement, benefit claim, product lock or real-human evidence is present.
- This package contains admission bytes and independent oracle reports only; workspace copies remain under `D:/tmp/rsi-live-admission-20261105-v3`.
