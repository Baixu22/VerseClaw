$ErrorActionPreference='Stop'
$env:TEMP='D:\tmp'
$env:TMP='D:\tmp'
$env:npm_config_verify_deps_before_run='false'
$env:OPENCLAW_BUILD_ALL_NO_PNPM='1'
$env:OPENCLAW_VITEST_MAX_WORKERS='1'
$ragWorkspace='C:\Users\27933\.codex\worktrees\project-rag-longterm-20261109\ClawX'
$ragRuntime=Join-Path $ragWorkspace 'openclaw_runtime'
$ragNode='C:\Program Files\nodejs\node.exe'
$ragPnpm='C:\Users\27933\AppData\Local\pnpm\.tools\pnpm\11.2.2\node_modules\pnpm\bin\pnpm.mjs'
if((Get-Location).Path -ne $ragWorkspace){throw 'Wrong worktree'}
if((git branch --show-current).Trim() -ne 'codex/project-rag-longterm-20261109' -or (git status --porcelain)){throw 'Expected clean source candidate'}
$ragCandidate=(git rev-parse HEAD).Trim()
$ragOutput=Join-Path 'D:\tmp\project-rag-TF-0882' ('formal-'+$ragCandidate.Substring(0,9))
if(Test-Path -LiteralPath (Join-Path $ragOutput 'gates.json')){throw 'This candidate already has a run; preserve its report and choose an explicit retry directory'}
New-Item -ItemType Directory -Force -Path $ragOutput | Out-Null
$ragModels=Join-Path $ragOutput 'models'
$ragOffline=Join-Path $ragOutput 'offline-network'
$env:CLAWX_HARNESS_CI_REPORT=Join-Path $ragOutput 'harness-ci-report.json'
$env:CLAWX_E2E_RUN_ROOT_BASE=Join-Path $ragOutput 'electron-runs'
$env:PROJECT_RAG_E2E_ASSETS_DIR='D:\tmp\project-rag-rag05-e2e-assets'
$env:PROJECT_RAG_OFFLINE_RECEIPT_DIR=$ragOffline
$env:PROJECT_RAG_OFFLINE_RUN_ID=$ragCandidate.Substring(0,9)
$env:SILICONFLOW_API_KEY=[Environment]::GetEnvironmentVariable('SILICONFLOW_API_KEY','User')
$env:SILICONFLOW_BASE_URL=[Environment]::GetEnvironmentVariable('SILICONFLOW_BASE_URL','User')
$env:SILICONFLOW_EMBEDDING_MODEL=[Environment]::GetEnvironmentVariable('SILICONFLOW_EMBEDDING_MODEL','User')
if(-not $env:SILICONFLOW_API_KEY){throw 'Authorized user environment credential is unavailable'}
$ragSteps=@(
 @{name='runtime-build';cwd=$ragWorkspace;kind='node';args=@('scripts/build-openclaw-runtime.mjs')},
 @{name='desktop-build';cwd=$ragWorkspace;args=@('run','build:vite')},
 @{name='runtime-unit';cwd=$ragRuntime;kind='node';args=@('scripts/run-vitest.mjs','src/context-engine/source-set.test.ts','--reporter=json','--outputFile',($ragOutput+'\runtime-unit.json'))},
 @{name='root-unit';cwd=$ragWorkspace;args=@('exec','vitest','run','tests/unit/project-rag-embedding-lifecycle.test.ts','tests/unit/knowledge-api.test.ts','tests/unit/knowledge-source-set-answer.test.ts','tests/unit/project-rag-owner-read.test.ts','tests/unit/knowledge-retrieval.test.ts','tests/unit/knowledge-embedding-deadline.test.ts','tests/unit/workspace-permissions.test.ts','tests/unit/gateway-permissions-api.test.ts','tests/unit/contract-check.test.ts','--maxWorkers=1','--reporter=json','--outputFile',($ragOutput+'\root-unit.json'))},
 @{name='typecheck';cwd=$ragWorkspace;args=@('run','typecheck')},
 @{name='root-lint';cwd=$ragWorkspace;args=@('exec','eslint','electron/services/knowledge-api.ts','electron/services/gateway-api.ts','electron/services/workspace-permissions.ts','src/components/settings/KnowledgeEmbeddingSettings.tsx','src/lib/host-api/knowledge/embedding.ts','shared/knowledge/embedding.ts','tests/unit/project-rag-embedding-lifecycle.test.ts','tests/unit/knowledge-api.test.ts','tests/e2e/project-rag-provider-settings.spec.ts','scripts/contract-check.mjs')},
 @{name='runtime-lint';cwd=$ragRuntime;kind='node';args=@('scripts/run-oxlint.mjs','src/knowledge/retrieval/embedding-space.ts','src/knowledge/retrieval/embedding-session.ts','src/plugins/openai-compatible-embedding-provider.ts','src/runtime-core/memory-embedding-provider.ts','src/context-engine/source-set.ts','extensions/memory-wiki/src/embedding-tokenizer.ts','extensions/memory-wiki/src/retrieval-embeddings.ts','extensions/memory-wiki/src/gateway.ts','packages/memory-host-sdk/src/host/embedding-model-artifact.ts','packages/memory-host-sdk/src/host/embeddings.ts','packages/memory-host-sdk/src/host/embeddings-worker.ts','packages/memory-host-sdk/src/host/embeddings-worker-child.ts','packages/memory-host-sdk/src/host/embeddings.types.ts','packages/memory-host-sdk/src/host/node-llama.ts')},
 @{name='contract';cwd=$ragWorkspace;kind='node';args=@('scripts/contract-check.mjs')},
 @{name='i18n';cwd=$ragWorkspace;kind='node';args=@('scripts/i18n-lint.mjs')},
 @{name='comms-replay';cwd=$ragWorkspace;args=@('run','comms:replay')},
 @{name='comms-compare';cwd=$ragWorkspace;args=@('run','comms:compare')},
 @{name='harness-validate';cwd=$ragWorkspace;args=@('harness','validate','--spec','harness/specs/tasks/project-rag-embedding-provider-lifecycle.md')},
 @{name='harness-dry-run';cwd=$ragWorkspace;args=@('harness','run','--spec','harness/specs/tasks/project-rag-embedding-provider-lifecycle.md','--dry-run')},
 @{name='harness-ci';cwd=$ragWorkspace;args=@('run','harness:ci')},
 @{name='artifact-retention';cwd=$ragWorkspace;kind='node';args=@('scripts/check-repository-artifacts.mjs')},
 @{name='local-model';cwd=$ragWorkspace;kind='node';args=@('--use-env-proxy','openclaw_runtime/node_modules/tsx/dist/cli.mjs','--tsconfig','tsconfig.node.json','D:/tmp/project-rag-TF-0882/local-formal-probe.ts',($ragOutput+'\local-model.json'),$ragModels)},
 @{name='offline-restart';cwd=$ragWorkspace;kind='node';args=@('--import=file:///D:/tmp/project-rag-TF-0882/offline-network-guard.mjs','openclaw_runtime/node_modules/tsx/dist/cli.mjs','--tsconfig','tsconfig.node.json','D:/tmp/project-rag-TF-0882/offline-formal-probe.ts',($ragOutput+'\offline-restart.json'),$ragModels)},
 @{name='electron';cwd=$ragWorkspace;args=@('exec','playwright','test','tests/e2e/project-rag-provider-settings.spec.ts','--workers=1','--reporter=json','--output',($ragOutput+'\electron'))}
)
$ragReport=@{schema='ProjectRagEmbeddingFormalGates/v1';candidate=$ragCandidate;worktree=$ragWorkspace;branch='codex/project-rag-longterm-20261109';actor='codex/project-rag';driven_by='agent';cleanAtStart=$true;status='running';results=@()}
foreach($ragStep in $ragSteps){
 if($ragStep.name -in @('runtime-build','desktop-build','runtime-unit','root-unit','typecheck','runtime-lint','harness-ci','local-model','offline-restart','electron')){
  $ragSamples=@()
  while($true){
   $ragFree=[Math]::Floor((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)
   $ragHeavy=@(Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq 'python.exe' -and $_.CommandLine -match 'task_forest.py (?:proposal-apply|export|init)') -or
    ($_.Name -eq 'node.exe' -and $_.CommandLine -match '(?:playwright[\\/].*cli\.js.*test|scripts[\\/]typecheck-agent-dev\.mjs|scripts[\\/]tsdown-build\.mjs)')
   })
   $ragSamples+=@{observedAt=[DateTimeOffset]::Now.ToString('o');freeMiB=$ragFree;otherHeavyPids=@($ragHeavy.ProcessId)}
   $ragSamples | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $ragOutput ($ragStep.name+'-resource.json')) -Encoding utf8
   if($ragFree -ge 3072 -and $ragHeavy.Count -eq 0){break}
   Write-Output ($ragStep.name+': waiting for actual memory/processes; '+$ragFree+' MiB free')
   Start-Sleep -Seconds 15
  }
 }
 if((git -C $ragWorkspace rev-parse HEAD).Trim() -ne $ragCandidate -or (git -C $ragWorkspace status --porcelain)){throw 'Source candidate changed during acceptance'}
 Set-Location -LiteralPath $ragStep.cwd
 $ragStarted=[DateTimeOffset]::UtcNow.ToString('o')
 $ragPriorNodeOptions=$env:NODE_OPTIONS
 if($ragStep.name -eq 'offline-restart'){$env:NODE_OPTIONS='--import=file:///D:/tmp/project-rag-TF-0882/offline-network-guard.mjs'}
 [string[]]$ragArgs=if($ragStep.kind -eq 'node'){$ragStep.args}else{@($ragPnpm,'--config.verify-deps-before-run=false')+$ragStep.args}
 if($ragStep.name -eq 'electron'){
  & $ragNode @ragArgs > (Join-Path $ragOutput 'electron.json') 2> (Join-Path $ragOutput 'electron.stderr.log')
 }else{
  & $ragNode @ragArgs > (Join-Path $ragOutput ($ragStep.name+'.log')) 2>&1
 }
 $ragCode=$LASTEXITCODE
 $env:NODE_OPTIONS=$ragPriorNodeOptions
 $ragReport.results+=@{name=$ragStep.name;exitCode=$ragCode;args=$ragArgs;cwd=$ragStep.cwd;startedAt=$ragStarted;finishedAt=[DateTimeOffset]::UtcNow.ToString('o')}
 $ragReport | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $ragOutput 'gates.json') -Encoding utf8
 Write-Output ($ragStep.name+': exit '+$ragCode)
}
Set-Location -LiteralPath $ragWorkspace
$ragReport.cleanAtEnd=-not [bool](git status --porcelain)
$ragReport.status=if($ragReport.cleanAtEnd -and @($ragReport.results | Where-Object {$_.exitCode -ne 0}).Count -eq 0){'pass'}else{'fail'}
$ragReport | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $ragOutput 'gates.json') -Encoding utf8
Write-Output ($ragReport.status+': '+$ragOutput)
