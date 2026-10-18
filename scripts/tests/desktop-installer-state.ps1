# Helper controls are portable; Windows locking, real installation and uninstall run separately.
$ErrorActionPreference = 'Stop'
$helper = Join-Path (Split-Path -Parent $PSScriptRoot) 'desktop-installer-state.ps1'
$root = Join-Path ([IO.Path]::GetTempPath()) ('octopus-state-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $root | Out-Null
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Check([string]$Operation, [string]$Path, [string]$Token = '123-456') {
  & $helper -Operation $Operation -Root $Path -Token $Token
}
function Refuses([scriptblock]$Action, [string]$Message) {
  $refused = $false
  try { & $Action } catch { $refused = $true }
  Assert $refused $Message
}
try {
  $stage = Join-Path $root 'app.octopus-stage-123-456'
  New-Item -ItemType Directory $stage | Out-Null
  [IO.File]::WriteAllText((Join-Path $stage '.octopus-installer-stage.ini'), "[stage]`r`ntoken=123-456`r`n")
  New-Item -ItemType Directory (Join-Path $stage 'resources') | Out-Null
  [IO.File]::WriteAllText((Join-Path $stage 'resources/node.exe'), 'NODE_FIXTURE')
  Check seal $stage
  Check verify $stage
  Check recognize $stage
  Refuses { Check verify $stage '999-999' } 'A foreign response token was accepted'
  [IO.File]::AppendAllText((Join-Path $stage 'resources/node.exe'), 'MANUAL_EDIT')
  Refuses { Check verify $stage } 'An edited inventory passed checksum validation'
  # Live installations can create runtime files; admission uses installer identity rather than checksum equality.
  Check recognize $stage
  $backup = Join-Path $root 'app.octopus-backup-123-456'
  Move-Item -LiteralPath $stage -Destination $backup
  Refuses { Check clean-backup $backup } 'A modified backup was removed'
  Assert (Test-Path -LiteralPath (Join-Path $backup 'resources/node.exe')) 'Modified backup was lost'
  [IO.File]::WriteAllText((Join-Path $backup 'resources/node.exe'), 'NODE_FIXTURE')
  Check clean-backup $backup
  Assert (-not (Test-Path -LiteralPath $backup)) 'Verified backup was not pruned'
  New-Item -ItemType Directory $backup | Out-Null
  [IO.File]::WriteAllText((Join-Path $backup 'first.txt'), 'CLEANUP_FIXTURE_A')
  [IO.File]::WriteAllText((Join-Path $backup 'second.txt'), 'CLEANUP_FIXTURE_B')
  Check seal $backup
  $productionHelper = $helper
  $faultHelper = Join-Path $root 'cleanup-fault.ps1'
  $needle = '  [IO.File]::Delete($marker)' + "`n" + '  foreach ($path in $paths) { [IO.File]::Delete($path) }'
  $replacement = '  [IO.File]::Delete($marker)' + "`n" + '  foreach ($path in $paths) { [IO.File]::Delete($path); throw "Injected failure after the first backup file deletion" }'
  $source = [IO.File]::ReadAllText($helper).Replace("`r`n", "`n")
  Assert ($source.Contains($needle)) 'Partial cleanup fault injection no longer matches the production deletion path'
  [IO.File]::WriteAllText($faultHelper, $source.Replace($needle, $replacement))
  $helper = $faultHelper
  Refuses { Check clean-backup $backup } 'Injected partial backup deletion unexpectedly completed'
  $helper = $productionHelper
  Assert (-not (Test-Path (Join-Path $backup '.octopus-installer-ready.json'))) 'Partially deleted backup kept its validity marker'
  Assert (-not (Test-Path (Join-Path $backup 'first.txt'))) 'Partial-cleanup control did not delete a backup file'
  Assert (Test-Path (Join-Path $backup 'second.txt')) 'Partial-cleanup control did not retain the remaining file'
  Check clean-backup $backup
  Assert (Test-Path (Join-Path $backup 'second.txt')) 'Retry treated partial leftovers as a valid backup'
  Remove-Item -LiteralPath $backup -Recurse
  New-Item -ItemType Directory $backup | Out-Null
  [IO.File]::WriteAllText((Join-Path $backup 'legacy-personal.txt'), 'LEGACY_BACKUP_MUST_REMAIN')
  Check clean-backup $backup
  Assert ((Get-Content (Join-Path $backup 'legacy-personal.txt') -Raw) -eq 'LEGACY_BACKUP_MUST_REMAIN') 'Unsealed legacy backup was deleted'
  New-Item -ItemType Directory $stage | Out-Null
  [IO.File]::WriteAllText((Join-Path $stage 'foreign.txt'), 'KEEP_FOREIGN')
  Refuses { Check recognize $stage } 'A nonempty unowned target was recognized'
  Refuses { Check clean-stage $stage } 'An unmarked stage was deleted'
  Refuses { Check clean-stage $stage '9-9' } 'An unrelated sibling was cleaned'
  Assert ((Get-Content -LiteralPath (Join-Path $stage 'foreign.txt') -Raw) -eq 'KEEP_FOREIGN') 'Unowned data changed'
  [IO.File]::WriteAllText((Join-Path $stage '.octopus-installer-stage.ini'), "[stage]`r`ntoken=123-456`r`n")
  Check seal $stage
  Check clean-stage $stage
  Assert (-not (Test-Path -LiteralPath $stage)) 'Sealed abandoned staging was not removed'
  New-Item -ItemType Directory $stage | Out-Null
  [IO.File]::WriteAllText((Join-Path $stage '.octopus-installer-stage.ini'), "[stage]`r`ntoken=9-9`r`n")
  Refuses { Check clean-stage $stage } 'Foreign ownership token was accepted'
  [IO.File]::WriteAllText((Join-Path $stage '.octopus-installer-stage.ini'), "[stage]`r`ntoken=123-456`r`n")
  $foreign = Join-Path $root 'foreign'
  New-Item -ItemType Directory $foreign | Out-Null
  [IO.File]::WriteAllText((Join-Path $foreign 'keep.txt'), 'REPARSE_MUST_SURVIVE')
  $link = Join-Path $stage 'link'
  $kind = if ($IsWindows) { 'Junction' } else { 'SymbolicLink' }
  New-Item -ItemType $kind -Path $link -Target $foreign | Out-Null
  Refuses { Check clean-stage $stage } 'A reparse point was followed during pruning'
  Assert ((Get-Content -LiteralPath (Join-Path $foreign 'keep.txt') -Raw) -eq 'REPARSE_MUST_SURVIVE') 'Reparse target changed'
  [IO.Directory]::Delete($link)
  Check clean-stage $stage
  Write-Output 'PASS: installer inventory ownership, token binding, safe stage/backup pruning, manual edits and reparse refusal'
} finally {
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
