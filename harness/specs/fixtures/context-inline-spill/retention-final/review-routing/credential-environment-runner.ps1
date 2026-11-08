param([string]$Gate='autoreview-owner-provider-final', [string]$PromptFile='D:/tmp/context-inline-spill-closeout-20261103/review-notes-candidate-b.md', [ValidateSet('branch','commit')][string]$ReviewMode='branch', [string]$CodexBin='C:/Users/27933/AppData/Local/OpenAI/Codex/bin/b6c7fc9497179c98/codex.exe')
$ErrorActionPreference='Stop'
$sessionPath='C:\Users\27933\.codex\archived_sessions\rollout-2026-11-03T16-00-05-01a1a06c-2a74-74d0-90cb-8afd9f0123c7.jsonl'
$keys=[Collections.Generic.HashSet[string]]::new()
foreach ($line in [IO.File]::ReadLines($sessionPath)) {
  if (-not $line.Contains('sk-a2a-')) { continue }
  $record=ConvertFrom-Json -InputObject $line -Depth 100
  if ($record.type -ne 'response_item' -or $record.payload.role -ne 'user') { continue }
  foreach ($part in $record.payload.content) {
    if ($part.type -ne 'input_text' -and $part.type -ne 'text') { continue }
    foreach ($match in [regex]::Matches($part.text,'sk-a2a-[A-Za-z0-9_-]+')) { [void]$keys.Add($match.Value) }
  }
}
if ($keys.Count -ne 1) { throw 'Expected the one owner-supplied runtime credential.' }
$previousKey=$env:CONTEXT_INLINE_SPILL_API_KEY
try {
  $env:CONTEXT_INLINE_SPILL_API_KEY=@($keys)[0]
  $targetArgs=if ($ReviewMode -eq 'commit') { @('--mode','commit','--commit','HEAD') } else { @('--mode','branch','--base','10dd6c472419437800bde7a07ff8e3440929bfc2') }
  & 'D:\tmp\context-inline-spill-closeout-20261103\run-evidence-command.ps1' -Gate $Gate -RequireClean -Command 'python' -CommandArgs (@('-X','utf8','D:/tmp/context-inline-spill-closeout-20261103/autoreview-owner-provider.py') + $targetArgs + @('--engine','codex','--model','codex=space-bunny','--codex-bin',$CodexBin,'--no-web-search','--prompt-file',$PromptFile,'--output',"D:/tmp/context-inline-spill-closeout-20261103/$Gate.txt",'--json-output',"D:/tmp/context-inline-spill-closeout-20261103/$Gate.review.json",'--stream-engine-output'))
  $reviewExit=$LASTEXITCODE
} finally {
  $env:CONTEXT_INLINE_SPILL_API_KEY=$previousKey
  $keys.Clear()
}
exit $reviewExit
