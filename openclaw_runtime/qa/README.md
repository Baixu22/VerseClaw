# Run the personal-agent QA pack

The source checkout includes ten executable personal-agent fixtures under
`qa/scenarios/`. Pack membership is defined in
`extensions/qa-lab/src/scenario-packs.ts`; each Markdown fixture contains a
`qa-scenario` definition and a `qa-flow` with deterministic final-state checks.

From the ClawX repository root on Windows, use the installed workspace
dependencies and a D: process temp directory:

```powershell
$env:TEMP = 'D:\tmp'
$env:TMP = 'D:\tmp'
$env:OPENCLAW_BUILD_PRIVATE_QA = '1'
$env:OPENCLAW_QA_KEEP_TEMP = '1'
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
pnpm --dir openclaw_runtime exec node scripts/build-all.mjs cliStartup
node scripts/qa-lab-personal-agent-acceptance.mjs --preflight --output-dir ".artifacts/qa-e2e/personal-agent-$runId-preflight"
node scripts/qa-lab-personal-agent-acceptance.mjs --output-dir ".artifacts/qa-e2e/personal-agent-$runId"
```

The dedicated driver calls the QA Lab public API and the retained Gateway
`dist/entry.js`. The upstream general CLI was retired in this source tree.
`OPENCLAW_BUILD_PRIVATE_QA=1` adds the QA runtime facades to the build; public SDK
entries remain required, and omitted upstream test-helper entrypoints are not
needed by this pack.

Use a fresh output directory for each retained run. The output directory must
stay inside the selected runtime repository root, as required by the existing
QA path policy. This workspace's C: checkout is a junction to D:, so repo-local
QA artifacts also reside on D:. Other checkouts must choose their effective
output root accordingly. `OPENCLAW_QA_KEEP_TEMP=1` preserves the disposable
Gateway profile for final-state inspection; the runner still stops its
Gateway, mock provider and QA Lab servers.

Read `qa-suite-summary.json`, the scenario steps and the per-scenario
`.proof.json` / `.events.json` files in the retained Gateway workspace.
Acceptance requires ten selected and executed scenarios, ten passes and no
unexpected skips. A missing fixture, empty catalog, corrupt YAML or failed
assertion must produce a nonzero exit. The preflight selects the first requested
scenario. Use repeated `--scenario <id>` options for a focused run.

From a clean committed candidate, run the automated negative controls:

```powershell
node scripts/qa-lab-personal-agent-acceptance.mjs --negative-controls
```

This command checks both build stamps against the clean candidate, archives the
source into an agent-owned D: temp directory, reuses installed dependencies and
the current build, hashes every copied build file, and changes only the archived
fixtures. Missing and empty catalogs must exit 1. A deliberately false final-state
oracle must produce one failure and one subsequent successful task. The controller
exits 0 only when all three controls behave as required, retains its JSON receipt
and logs, and verifies that the original source is unchanged.

The focused strict type gate is
`pnpm --dir openclaw_runtime exec node scripts/run-tsgo.mjs -p test/tsconfig/tsconfig.qa-lab.test.json`.
The focused startup tests also verify that provider or Gateway acquisition failure
closes the already-started HTTP listeners.

The preference case reads a persistent workspace fixture through the real
read tool in a fresh session. It does not enable or validate retired Runtime
Memory injection/persistence. Approval denial uses an agent observer connection,
a real two-phase Gateway decision and a deny exec policy in a disposable profile.
The Gateway's delivery-route guard stays active. All inputs, actions and verdicts are
`driven_by: agent`. The provider is scripted: this pack proves source-host
control flow, file/tool and channel semantics, failure handling and
continuation, not live model quality or packaged behavior.

The acceptance contract and curated evidence live in
`harness/specs/tasks/qa-lab-personal-agent-pack.md` and
`harness/specs/fixtures/product-acceptance-closeout/a5-qa-pack/` at the ClawX
root. Product locks and release approval are unchanged by these checks.
