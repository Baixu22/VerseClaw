# ComponentGraduationReport/v1 fixtures

These fixtures test the component-graduation report schema and gate only. They do not represent product approval, live evidence or real-human evidence.

- `positive-*.json`: schema and disposition/evidence-matrix fixtures for internal, default, advanced, retired, shadow and contract reports.
- `negative-cases.json`: machine-readable mutation cases for missing fields, actor mistakes, disposition/evidence mismatch, artifact missing/hash drift, stale source/build, scope/actor/model mismatch, unsupported raw conclusions and recompute drift.
- `negative-invalid-report.json` and `negative-default-change.json`: standalone CLI gate fixtures for invalid-report and disallowed default-change exit paths.
- `expected-context.json`: canonical binding values used by the fixture validator.
- `artifacts/raw-evidence.json`: synthetic raw fixture data referenced by every positive report.

Run the validator through the repository TypeScript runtime:

```sh
pnpm --dir openclaw_runtime exec tsx ../scripts/component-graduation-report.mts --report harness/specs/fixtures/component-graduation-report/positive-internal.json --expected-context harness/specs/fixtures/component-graduation-report/expected-context.json --require-graduation
```

Shadow and experiment reports are schema-valid but intentionally do not pass graduation or close a Task Forest done node. Synthetic fixtures never count as product or human evidence.