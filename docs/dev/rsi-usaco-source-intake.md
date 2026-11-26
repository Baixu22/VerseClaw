# Preparing USACO calibration inputs

For a newly downloaded source, store the four acquisition records in a JSON
file with schemaVersion `RsiUsacoSnapshotReceipt/v1`. Its `artifacts` maps
`results`, `problem`, `solution` and `tests` to their canonical official
URL (`url`) and original byte digest (`sha256`). The intake plan references
this local file via `snapshotReceipt.file` and `snapshotReceipt.sha256`.
Capture this mapping during acquisition, independently of the intake plan.
The checked-in records in `harness/specs/fixtures/rsi-live-experience/usaco-output-contracts.json`
can supply the same binding for an existing reviewed snapshot.

Record `normalized-text` in that registry only after confirming that every
valid output has the same normalized text. Include the reason and reviewed
artifact identities. An unreviewed source or a source requiring a custom
checker can participate in deduplication and stays out of text calibration.
Run historical v1 family replays with their original frozen commit.

Run the three offline steps in order.

1. Run `python -B scripts/rsi-usaco-source-intake.py --plan <source-plan> --plan-sha256 <digest> --output-directory <candidate>` to read the official snapshots and mark public sample pairs.
2. Run `python -B scripts/rsi-usaco-family-review.py --plan <family-plan> --plan-sha256 <digest> --output-directory <review>` to join candidates with the source queue, previously observed packs and excluded base families.
3. On a clean executor, run `python -B scripts/rsi-usaco-measurement.py --family-plan <family-plan> --family-plan-sha256 <digest> --family-directory <review> --output-directory <inputs> --python-version "<frozen interpreter version>"`. This prepares original vectors for reviewed new Python components.

Use new output directories for preparation. Add `--verify` to replay each step against its saved output.
