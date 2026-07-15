# DCS W5/W6 10-minute gate poller
# Polls completion markers and launches codex exec in a new process when unblocked.
# Only one of W5 or W6 is started per poll, and only if predecessor COMPLETE exists.

param(
  [string]$RepoRoot = "C:\Users\27933\Desktop\clawx\ClawX",
  [string]$CodexExe = "$env:LOCALAPPDATA\OpenAI\Codex\bin\codex.exe",
  [string]$StateDir = "C:\Users\27933\Desktop\clawx\ClawX\team\dcs\wiring-automations",
  [int]$LockMaxAgeHours = 2
)

$ErrorActionPreference = "Stop"
$logPath = Join-Path $StateDir "poller.log"
$statePath = Join-Path $StateDir "poller-state.json"

function Write-Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  Write-Output $line
}

function Test-FreshLock([string]$lockPath) {
  if (-not (Test-Path $lockPath)) { return $false }
  $age = (Get-Date) - (Get-Item $lockPath).LastWriteTime
  if ($age.TotalHours -gt $LockMaxAgeHours) {
    Write-Log "Stale lock removed: $lockPath ageHours=$([math]::Round($age.TotalHours,2))"
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    return $false
  }
  return $true
}

function Get-State {
  if (Test-Path $statePath) {
    try { return Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
  }
  return [pscustomobject]@{
    lastPollAt = $null
    lastAction = "init"
    w5LaunchedAt = $null
    w6LaunchedAt = $null
    w5Pid = $null
    w6Pid = $null
  }
}

function Save-State($state) {
  $state | ConvertTo-Json | Set-Content -Path $statePath -Encoding UTF8
}

function Test-ProcessAlive($procId) {
  if (-not $procId) { return $false }
  try {
    $p = Get-Process -Id $procId -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Start-WindowJob {
  param(
    [ValidateSet("W5","W6")][string]$Window,
    [string]$PromptPath,
    [string]$CompletePath,
    [string]$LockPath
  )

  if (-not (Test-Path $CodexExe)) {
    Write-Log "ERROR codex.exe missing: $CodexExe"
    return $null
  }
  if (-not (Test-Path $PromptPath)) {
    Write-Log "ERROR prompt missing: $PromptPath"
    return $null
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $outLog = Join-Path $StateDir ("{0}-run-{1}.log" -f $Window.ToLower(), $stamp)
  $errLog = Join-Path $StateDir ("{0}-run-{1}.err.log" -f $Window.ToLower(), $stamp)

  # lock written by poller before spawn; runner prompt also re-checks
  @(
    "window=$Window"
    "startedAt=$((Get-Date).ToString('o'))"
    "launcher=poller"
    "pid=pending"
  ) | Set-Content -Path $LockPath -Encoding UTF8

  $argList = @(
    "exec",
    "--skip-git-repo-check",
    "-C", $RepoRoot,
    "-s", "danger-full-access",
    "-a", "never",
    "--dangerously-bypass-approvals-and-sandbox",
    "-"
  )

  Write-Log "Launching $Window via codex exec; complete=$CompletePath log=$outLog"
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $CodexExe
  $psi.Arguments = ($argList | ForEach-Object {
    if ($_ -match '\s') { '"{0}"' -f $_ } else { $_ }
  }) -join ' '
  $psi.WorkingDirectory = $RepoRoot
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()

  $promptText = Get-Content -LiteralPath $PromptPath -Raw -Encoding UTF8
  $proc.StandardInput.Write($promptText)
  $proc.StandardInput.Close()

  # async drain to files
  Start-Job -ScriptBlock {
    param($p, $o, $e)
    try {
      $p.StandardOutput.ReadToEnd() | Set-Content -Path $o -Encoding UTF8
    } catch {}
    try {
      $p.StandardError.ReadToEnd() | Set-Content -Path $e -Encoding UTF8
    } catch {}
  } -ArgumentList $proc, $outLog, $errLog | Out-Null

  @(
    "window=$Window"
    "startedAt=$((Get-Date).ToString('o'))"
    "launcher=poller"
    "pid=$($proc.Id)"
    "outLog=$outLog"
  ) | Set-Content -Path $LockPath -Encoding UTF8

  Write-Log "Started $Window pid=$($proc.Id)"
  return $proc.Id
}

# --- main ---
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$state = Get-State
$state.lastPollAt = (Get-Date).ToString("o")

$w4 = Join-Path $RepoRoot "team\dcs\DCS-W4-COMPLETE.md"
$w5 = Join-Path $RepoRoot "team\dcs\DCS-W5-COMPLETE.md"
$w6 = Join-Path $RepoRoot "team\dcs\DCS-W6-COMPLETE.md"
$w5Lock = Join-Path $RepoRoot "team\dcs\.w5.lock"
$w6Lock = Join-Path $RepoRoot "team\dcs\.w6.lock"
$w5Prompt = Join-Path $StateDir "W5-PROMPT.md"
$w6Prompt = Join-Path $StateDir "W6-PROMPT.md"

Write-Log "Poll begin w4=$(Test-Path $w4) w5=$(Test-Path $w5) w6=$(Test-Path $w6)"

# clear finished process pids from state
if ($state.w5Pid -and -not (Test-ProcessAlive $state.w5Pid)) {
  Write-Log "W5 process ended pid=$($state.w5Pid)"
  $state.w5Pid = $null
}
if ($state.w6Pid -and -not (Test-ProcessAlive $state.w6Pid)) {
  Write-Log "W6 process ended pid=$($state.w6Pid)"
  $state.w6Pid = $null
}

# Prefer W5 then W6; never both in same poll
if (-not (Test-Path $w5)) {
  if (-not (Test-Path $w4)) {
    $state.lastAction = "WAITING_FOR_W4"
    Write-Log "WAITING_FOR_W4"
    Save-State $state
    exit 0
  }
  if (Test-FreshLock $w5Lock) {
    $state.lastAction = "W5_IN_PROGRESS"
    Write-Log "W5_IN_PROGRESS lock present"
    Save-State $state
    exit 0
  }
  if ($state.w5Pid -and (Test-ProcessAlive $state.w5Pid)) {
    $state.lastAction = "W5_PROCESS_ALIVE"
    Write-Log "W5 process still alive pid=$($state.w5Pid)"
    Save-State $state
    exit 0
  }
  $launchedPid = Start-WindowJob -Window W5 -PromptPath $w5Prompt -CompletePath $w5 -LockPath $w5Lock
  $state.w5LaunchedAt = (Get-Date).ToString("o")
  $state.w5Pid = $launchedPid
  $state.lastAction = if ($launchedPid) { "LAUNCHED_W5" } else { "LAUNCH_W5_FAILED" }
  Save-State $state
  exit 0
}

# W5 done
if (-not (Test-Path $w6)) {
  if (Test-FreshLock $w6Lock) {
    $state.lastAction = "W6_IN_PROGRESS"
    Write-Log "W6_IN_PROGRESS lock present"
    Save-State $state
    exit 0
  }
  if ($state.w6Pid -and (Test-ProcessAlive $state.w6Pid)) {
    $state.lastAction = "W6_PROCESS_ALIVE"
    Write-Log "W6 process still alive pid=$($state.w6Pid)"
    Save-State $state
    exit 0
  }
  $launchedPid = Start-WindowJob -Window W6 -PromptPath $w6Prompt -CompletePath $w6 -LockPath $w6Lock
  $state.w6LaunchedAt = (Get-Date).ToString("o")
  $state.w6Pid = $launchedPid
  $state.lastAction = if ($launchedPid) { "LAUNCHED_W6" } else { "LAUNCH_W6_FAILED" }
  Save-State $state
  exit 0
}

$state.lastAction = "ALL_DONE"
Write-Log "ALL_DONE W5 and W6 complete; poller idle"
Save-State $state
exit 0

