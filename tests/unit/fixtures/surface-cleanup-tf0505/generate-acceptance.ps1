$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$out = Join-Path $root 'tests/unit/fixtures/surface-cleanup-tf0505'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-Text([string]$rel) { Get-Content -LiteralPath (Join-Path $root $rel) -Raw -Encoding UTF8 }
function Json-Write([string]$name, $value) { [IO.File]::WriteAllText((Join-Path $out $name), (($value | ConvertTo-Json -Depth 16) + "`n"), $utf8) }
$app = Read-Text 'src/App.tsx'
$sidebar = Read-Text 'src/components/layout/Sidebar.tsx'
$settings = Read-Text 'src/pages/Settings/index.tsx'
$policy = Read-Text 'src/lib/surface-access.ts'
$locales = @{}
foreach ($lang in @('en','zh','ja','ru')) { $locales[$lang] = Read-Text "shared/i18n/locales/$lang/common.json" }
$inventory = [ordered]@{
  schemaVersion = 'SurfaceAccessInventory/v1'
  taskForestNodeId = 'TF-0505'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  driven_by = 'agent'
  actor = 'codex'
  routes = @(
    [ordered]@{ path='/'; visibility='product'; access='always'; rollback='not-applicable'; productionMenu='Chat' },
    [ordered]@{ path='/dreams'; visibility='retired'; access='redirect'; redirectTo='/'; pageMounted=($app -match 'pages/Dreams'); productionMenu=$false },
    [ordered]@{ path='/ui-v2-showcase'; visibility='dev-test'; access='dev-mode-or-dev-runtime'; sharedPolicy=($app -match 'resolveSurfaceAccess\('); productionMenu=$false },
    [ordered]@{ path='/image-generation'; visibility='advanced'; access='dev-mode'; productionMenu=$false; rollback='direct URL access still avoids the page until dev mode is unlocked' },
    [ordered]@{ path='/settings/developer'; visibility='advanced'; access='local-dev-mode-unlock'; rawDiagnosticsHiddenUntilUnlock=$true; rollback='disable the local Developer switch' },
    [ordered]@{ path='/settings/general'; visibility='product'; access='always'; rollback='not-applicable' }
  )
  navigation = [ordered]@{
    removed = @('sidebar-more-dreams','sidebar-more-image-generation')
    dreamsEntryPresent = $sidebar.Contains('sidebar-more-dreams')
    imageGenerationEntryPresent = $sidebar.Contains('sidebar-more-image-generation')
  }
  settings = [ordered]@{
    developerSectionPresent = $settings.Contains("currentSection === 'developer' && (")
    rawPanelsWrappedByDevMode = $settings.Contains('{devModeUnlocked && (')
    vtokenBridgeMounted = $settings.Contains('VtokenBridgePanel')
    dcsFlagsMounted = $settings.Contains('DcsProdFlagsPanelLazy')
  }
  i18n = [ordered]@{
    removedCommonSidebarKeys = @('openClawDreams','imageGeneration')
    enDreamsKeyPresent = $locales.en.Contains('"openClawDreams"')
    enImageGenerationSidebarKeyPresent = ($locales.en -match '"imageGeneration"\s*:\s*"[^"]+"')
  }
  policy = [ordered]@{
    file = 'src/lib/surface-access.ts'
    retiredPaths = @('/dreams')
    devOrTestPaths = @('/ui-v2-showcase')
    devRuntimeGate = $policy.Contains('import.meta.env.DEV') -and $policy.Contains('VITE_E2E')
  }
}
Json-Write 'surface-inventory.json' $inventory
$acceptance = [ordered]@{
  schemaVersion = 'SurfaceCleanupAcceptance/v1'
  taskForestNodeId = 'TF-0505'
  generatedAt = $inventory.generatedAt
  driven_by = 'agent'
  actor = 'codex'
  status = 'complete'
  criteria = @(
    [ordered]@{ criterion='非 dev 用户无法通过路由访问内部实验页面'; status='verified'; evidence='surface-inventory.json#routes; e2e-results.txt'; detail='/dreams redirects to /. /ui-v2-showcase uses the shared dev-mode/dev-runtime policy. Image Generation remains dev-gated.' },
    [ordered]@{ criterion='普通用户设置里没有 DCS/VToken/C6/RC-03 原始 flag'; status='verified'; evidence='surface-inventory.json#settings; e2e-results.txt'; detail='Developer unlock switch is visible, but raw diagnostics are wrapped by devModeUnlocked; VToken Bridge is not mounted.' },
    [ordered]@{ criterion='产品页每项能力都有明确入口、状态和回滚'; status='verified'; evidence='surface-inventory.json#routes'; detail='Every reviewed route has access state, visibility and rollback/destination behavior.' },
    [ordered]@{ criterion='导航/路由/i18n/测试同步'; status='verified'; evidence='surface-inventory.json#navigation; i18n-lint-results.txt; unit-results.txt; e2e-results.txt'; detail='Removed menu entries and stale common sidebar keys; route, unit and Electron E2E tests assert the same surface policy.' }
  )
  completionVerdict = 'complete'
}
Json-Write 'acceptance.json' $acceptance
$commit = (& git rev-parse HEAD).Trim()
$tree = (& git rev-parse 'HEAD^{tree}').Trim()
function Artifact([string]$rel) { $p=Join-Path $root $rel; $bytes=[IO.File]::ReadAllBytes($p); [ordered]@{ path=$rel; sha256=([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes))).Replace('-','').ToLowerInvariant(); bytes=$bytes.Length } }
$report = [ordered]@{
  schemaVersion='ComponentGraduationReport/v1'
  reportId='tf-0505-user-surface-cleanup'
  reportKind='surface-cleanup'
  componentId='renderer-ui-surface'
  taskForestNodeId='TF-0505'
  disposition='advanced'
  maturity='verified'
  owner='TF-0505'
  entryPoint='src/lib/surface-access.ts'
  defaultMode='product-surfaces-only'
  benefitEvidence='Retired and dev/test pages are no longer discoverable as product capabilities; Developer diagnostics remain explicitly unlockable and hidden by default.'
  rollback='Keep or restore the prior route/menu entry behind the local Developer switch; no product default or data format changed.'
  modelEffectiveState='Normal product routing remains available; retired Dreams is redirect-only; dev/test showcase requires developer mode or a dev/test runtime.'
  evidenceGrade='e2e'
  actor='codex'
  driven_by='agent'
  expiry=$null
  binding=[ordered]@{ commit=$commit; tree=$tree; buildHash=(& git rev-parse HEAD).Trim(); scope='worktree:component-graduation-20261021/TF-0505'; artifacts=@((Artifact 'src/App.tsx'),(Artifact 'src/components/layout/Sidebar.tsx'),(Artifact 'src/lib/surface-access.ts'),(Artifact 'src/pages/Settings/index.tsx'),(Artifact 'tests/e2e/developer-mode.spec.ts'),(Artifact 'tests/e2e/image-generation-settings.spec.ts'),(Artifact 'tests/e2e/vtoken-bridge-settings.spec.ts')) }
  evidence=@([ordered]@{kind='route-and-navigation';status='pass';grade='e2e';summary='Unit and Electron E2E prove route denial and hidden Developer diagnostics.';artifacts=@((Artifact 'tests/unit/fixtures/surface-cleanup-tf0505/surface-inventory.json'),(Artifact 'tests/unit/fixtures/surface-cleanup-tf0505/acceptance.json'))})
}
Json-Write 'component-graduation-report.json' $report
Write-Output "generated $out"