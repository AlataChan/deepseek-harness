# Native Windows controls execute the production transaction include in compiled NSIS installers.
param([Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
$NodePath = (Resolve-Path $NodePath).Path
if (-not $IsWindows) { throw 'Native Windows is required; this control must not be skipped as a pass' }
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Full desktop launch controls require an ephemeral Windows Actions runner; do not run against a personal Windows profile' }
& (Join-Path $PSScriptRoot 'desktop-installer-state.ps1')
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
# Recompile the complete template as rendered by pinned Tauri, including its real uninstall section.
$rendered = Join-Path $root 'apps\desktop\src-tauri\target\release\nsis\x64\installer.nsi'
if (-not (Test-Path -LiteralPath $rendered)) { throw 'Actual Tauri-rendered installer template is required' }
$nsis = Get-ChildItem "$env:LOCALAPPDATA\tauri" -Recurse -Filter makensis.exe | Select-Object -First 1
if (-not $nsis) { throw 'Pinned Tauri NSIS must be installed by build-exe first' }
# NSIS payload paths must stay short; runner drive roots are disposable and writable.
$testRoot = Join-Path ([IO.Path]::GetPathRoot($env:RUNNER_TEMP)) ('oi-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory $testRoot | Out-Null
$install = Join-Path $testRoot 'app'
$userData = Join-Path $testRoot 'user-home'
New-Item -ItemType Directory $userData | Out-Null
[IO.File]::WriteAllText((Join-Path $userData 'original.txt'), 'USER_ORIGINAL_MUST_SURVIVE')
$owned = [Collections.Generic.List[Diagnostics.Process]]::new()
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Compile([string]$Version, [string[]]$Defines = @()) {
  $name = $Version + ($Defines -join '-')
  $out = Join-Path $testRoot "$name.exe"
  $definitionText = ($Defines | ForEach-Object { "!define $_" }) -join "`n"
  $include = Join-Path $root 'scripts\desktop-installer-transaction.nsh'
  if ($Defines -contains 'OCTOPUS_TEST_FAIL_PARTIAL_CLEANUP') {
    # Instrument only the production helper's filesystem deletion for a deterministic I/O fault.
    $support = Join-Path $testRoot $name
    New-Item -ItemType Directory $support | Out-Null
    Copy-Item $include (Join-Path $support 'desktop-installer-transaction.nsh')
    $source = [IO.File]::ReadAllText((Join-Path $root 'scripts\desktop-installer-state.ps1')).Replace("`r`n", "`n")
    $needle = '  [IO.File]::Delete($marker)' + "`n" + '  foreach ($path in $paths) { [IO.File]::Delete($path) }'
    $replacement = '  [IO.File]::Delete($marker)' + "`n" + '  foreach ($path in $paths) { [IO.File]::Delete($path); throw "Injected partial backup cleanup failure" }'
    Assert ($source.Contains($needle)) 'Production cleanup fault injection did not match'
    [IO.File]::WriteAllText((Join-Path $support 'desktop-installer-state.ps1'), $source.Replace($needle, $replacement))
    $include = Join-Path $support 'desktop-installer-transaction.nsh'
  }

  $nsi = @'
Unicode true
RequestExecutionLevel user
SilentInstall silent
!include LogicLib.nsh
!define MAINBINARYNAME "app"
__DEFINES__
!include "__INCLUDE__"
OutFile "__OUT__"
InstallDir "__INSTALL__"
Section
  Call TxBegin
  SetOutPath $TxStage
  FileOpen $0 "$TxStage\app.exe" w
  FileWrite $0 "__VERSION__"
  FileClose $0
  CreateDirectory "$TxStage\resources"
  CopyFiles /SILENT "__NODE__" "$TxStage\resources\node.exe"
  FileOpen $0 "$TxStage\resources\version.txt" w
  FileWrite $0 "__VERSION__"
  FileClose $0
  SetOutPath $TEMP
  Call TxCommit
SectionEnd
'@
  $nsi = $nsi.Replace('__DEFINES__', $definitionText).Replace('__INCLUDE__', $include).Replace('__OUT__', $out).Replace('__INSTALL__', $install).Replace('__NODE__', $NodePath).Replace('__VERSION__', $Version)
  $path = Join-Path $testRoot "$name.nsi"
  [IO.File]::WriteAllText($path, $nsi)
  & $nsis.FullName /V2 $path | Write-Host
  if ($LASTEXITCODE -ne 0) { throw "NSIS fixture compile failed: $name" }
  return $out
}
function Run([string]$Setup) {
  $p = Start-Process -FilePath $Setup -ArgumentList '/S', "/D=$install" -PassThru
  $owned.Add($p)
  if (-not $p.WaitForExit(40000)) { $p.Kill(); $p.WaitForExit(); throw 'Installer exceeded bounded retry deadline' }
  return $p.ExitCode
}
function CheckVersion([string]$Version) {
  Assert ((Get-Content (Join-Path $install 'app.exe') -Raw) -eq $Version) "Main executable is not $Version"
  Assert ((Get-Content (Join-Path $install 'resources\version.txt') -Raw) -eq $Version) "Companion payload is not $Version"
}
function HoldCompanion([int]$Seconds) {
  $ready = Join-Path $testRoot ([Guid]::NewGuid().ToString('N') + '.ready')
  $script = Join-Path $testRoot ([Guid]::NewGuid().ToString('N') + '.ps1')
  $node = Join-Path $install 'resources\node.exe'
  [IO.File]::WriteAllText($script, @"
`$f=[IO.File]::Open('$node', 'Open', 'Read', 'None')
try { [IO.File]::WriteAllText('$ready','ready'); Start-Sleep -Seconds $Seconds } finally { `$f.Dispose() }
"@)
  $p = Start-Process pwsh -ArgumentList '-NoProfile', '-File', $script -PassThru
  $owned.Add($p)
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while (-not (Test-Path $ready)) { if ($p.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw 'Companion lock holder failed to start' }; Start-Sleep -Milliseconds 25 }
  return $p
}
function HoldRunningCompanion([int]$Seconds) {
  $ready = Join-Path $testRoot ([Guid]::NewGuid().ToString('N') + '.pid')
  $script = Join-Path $testRoot ([Guid]::NewGuid().ToString('N') + '.ps1')
  $node = Join-Path $install 'resources\node.exe'
  [IO.File]::WriteAllText($script, @"
`$p=Start-Process '$node' -ArgumentList '-e','setInterval(()=>{},1000)' -PassThru
try { Start-Sleep -Milliseconds 300; if(`$p.HasExited){throw 'Companion failed to start'}; [IO.File]::WriteAllText('$ready',`$p.Id.ToString()); Start-Sleep -Seconds $Seconds } finally { if(-not `$p.HasExited){`$p.Kill(); `$p.WaitForExit()} }
"@)
  $wrapper = Start-Process pwsh -ArgumentList '-NoProfile', '-File', $script -PassThru
  $owned.Add($wrapper)
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while (-not (Test-Path $ready)) { if ($wrapper.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw 'Natural companion failed to start' }; Start-Sleep -Milliseconds 25 }
  $owned.Add([Diagnostics.Process]::GetProcessById([int](Get-Content $ready -Raw)))
  return $wrapper
}
function Journal([string]$Target, [string]$Backup, [string]$Stage, [string]$State = 'replacing') {
  [IO.File]::WriteAllText("$install.octopus-transaction.ini", "[transaction]`r`ntarget=$Target`r`nbackup=$Backup`r`nstage=$Stage`r`nstate=$State`r`ntoken=$($Stage.Substring(("$install.octopus-stage-").Length))`r`n")
}
try {
  $windowsConfig = Get-Content (Join-Path $root 'apps\desktop\src-tauri\tauri.windows.conf.json') -Raw | ConvertFrom-Json
  Assert (($windowsConfig.bundle.windows.allowDowngrades -is [bool]) -and -not $windowsConfig.bundle.windows.allowDowngrades) 'Production Windows configuration must explicitly refuse downgrades'
  Push-Location (Split-Path -Parent $rendered)
  try {
    & $nsis.FullName /V2 /INPUTCHARSET UTF8 $rendered | Write-Host
    if ($LASTEXITCODE -ne 0) { throw 'Actual Tauri template (including uninstall) cannot compile' }
  } finally { Pop-Location }
  $renderedText = Get-Content -LiteralPath $rendered -Raw
  $downgradePolicy = [Regex]::Match($renderedText, '(?m)^!define ALLOWDOWNGRADES "([^"]+)"').Groups[1].Value
  Assert ($downgradePolicy -ceq 'false') 'Actual Tauri-rendered production installer must refuse downgrades'
  $installerOutput = [Regex]::Match($renderedText, '(?m)^!define OUTFILE "([^"]+)"').Groups[1].Value
  if (-not $installerOutput) { throw 'Rendered template has no installer output' }
  if (-not [IO.Path]::IsPathRooted($installerOutput)) { $installerOutput = Join-Path (Split-Path -Parent $rendered) $installerOutput }
  $mainName = [Regex]::Match($renderedText, '(?m)^!define MAINBINARYNAME "([^"]+)"').Groups[1].Value
  if (-not $mainName) { throw 'Rendered template has no executable name' }
  $fullInstall = Join-Path $testRoot 'full'
  $actual = Start-Process -FilePath $installerOutput -ArgumentList '/S', "/D=$fullInstall" -PassThru
  $owned.Add($actual)
  if (-not $actual.WaitForExit(120000)) { throw 'Actual installer exceeded its deadline' }
  Assert ($actual.ExitCode -eq 0) 'Actual template installation failed'
  Assert (Test-Path (Join-Path $fullInstall "$mainName.exe")) 'Actual installer did not publish the main executable'
  # Start the shipped GUI executable before upgrading, not a fake main or node-only fixture.
  $appStart = [Diagnostics.ProcessStartInfo]::new((Join-Path $fullInstall "$mainName.exe"))
  $appStart.UseShellExecute = $false
  foreach ($key in @($appStart.Environment.Keys)) {
    if ($key -match 'KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION') { [void]$appStart.Environment.Remove($key) }
  }
  $appStart.Environment['DSH_HOME'] = Join-Path $userData '.dsh'
  $appStart.Environment['OCTOPUS_APP_DATA'] = Join-Path $userData 'app-data'
  $appStart.Environment['DSH_TELEMETRY_DISABLED'] = '1'
  $liveApp = [Diagnostics.Process]::Start($appStart)
  $owned.Add($liveApp)
  Start-Sleep -Seconds 5
  Assert (-not $liveApp.HasExited) 'Real installed application exited before upgrade preparation'
  $liveApp.Kill($true)
  Assert ($liveApp.WaitForExit(30000)) 'Real installed application did not stop before upgrade'
  [IO.File]::WriteAllText((Join-Path $fullInstall 'runtime-generated.txt'), 'RUNTIME_WRITES_MUST_NOT_BLOCK_UPGRADE')
  $actual = Start-Process -FilePath $installerOutput -ArgumentList '/S', "/D=$fullInstall" -PassThru
  $owned.Add($actual)
  if (-not $actual.WaitForExit(120000)) { throw 'Post-launch upgrade exceeded its deadline' }
  Assert ($actual.ExitCode -eq 0) 'Runtime writes prevented a routine upgrade after actual application launch'
  Assert (-not (Test-Path "$fullInstall.octopus-transaction.ini")) 'Retained runtime backup left a blocking journal'
  $runtimeBackups = @(Get-ChildItem "$fullInstall.octopus-backup-*" -Directory)
  Assert ($runtimeBackups.Count -eq 1) 'Runtime data was discarded instead of retained in its backup'
  Assert ((Get-Content (Join-Path $runtimeBackups[0].FullName 'runtime-generated.txt') -Raw) -eq 'RUNTIME_WRITES_MUST_NOT_BLOCK_UPGRADE') 'Runtime-generated data was deleted'
  Remove-Item $runtimeBackups[0].FullName -Recurse

  # Exercise the actual template's silent downgrade guard without building a second full payload.
  $version = [Regex]::Match($renderedText, '(?m)^!define VERSION "([^"]+)"').Groups[1].Value
  $product = [Regex]::Match($renderedText, '(?m)^!define PRODUCTNAME "([^"]+)"').Groups[1].Value
  $uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product"
  Assert (Test-Path $uninstallKey) 'Current-user registration required for downgrade control'
  Set-ItemProperty $uninstallKey DisplayVersion '9999.0.0'
  try {
    $actual = Start-Process -FilePath $installerOutput -ArgumentList '/S', "/D=$fullInstall" -PassThru
    $owned.Add($actual)
    if (-not $actual.WaitForExit(30000)) { throw 'Downgrade refusal exceeded its deadline' }
    Assert ($actual.ExitCode -ne 0) 'Actual production installer silently replaced a newer registered installation'
    Assert (-not (Test-Path "$fullInstall.octopus-transaction.ini")) 'Downgrade refusal modified transaction state'
  } finally { Set-ItemProperty $uninstallKey DisplayVersion $version }

  # Compile the explicit opt-in policy separately; this is not the shipped configuration.
  $policyOutput = Join-Path $testRoot 'allow-downgrade-policy.exe'
  $policySource = $renderedText.Replace('!define ALLOWDOWNGRADES "false"', '!define ALLOWDOWNGRADES "true"')
  $policySource = [Regex]::Replace($policySource, '(?m)^!define OUTFILE "[^"]+"', ('!define OUTFILE "' + $policyOutput + '"'))
  $policyPath = Join-Path (Split-Path -Parent $rendered) 'allow-downgrade-policy.nsi'
  [IO.File]::WriteAllText($policyPath, $policySource)
  Push-Location (Split-Path -Parent $rendered)
  try {
    & $nsis.FullName /V2 /INPUTCHARSET UTF8 $policyPath | Write-Host
    if ($LASTEXITCODE -ne 0) { throw 'Explicit allow-downgrade template policy cannot compile' }
  } finally { Pop-Location; Remove-Item $policyPath }
  # A pre-transaction installation is identified by its existing registration, never folder contents alone.
  Remove-Item (Join-Path $fullInstall '.octopus-installer-ready.json')
  [IO.File]::WriteAllText((Join-Path $fullInstall 'legacy-personal.txt'), 'KEEP_LEGACY_BACKUP')
  for ($upgrade = 0; $upgrade -lt 2; $upgrade++) {
    $actual = Start-Process -FilePath $installerOutput -ArgumentList '/S', "/D=$fullInstall" -PassThru
    $owned.Add($actual)
    if (-not $actual.WaitForExit(120000)) { throw 'Actual legacy upgrade exceeded its deadline' }
    Assert ($actual.ExitCode -eq 0) 'Registered legacy upgrade failed'
  }
  $legacyBackups = @(Get-ChildItem "$fullInstall.octopus-backup-*" -Directory)
  Assert ($legacyBackups.Count -eq 1) 'Legacy backup retention grew across subsequent sealed upgrades'
  Assert ((Get-Content (Join-Path $legacyBackups[0].FullName 'legacy-personal.txt') -Raw) -eq 'KEEP_LEGACY_BACKUP') 'Unowned legacy files were deleted'
  [IO.File]::WriteAllText((Join-Path $fullInstall 'personal.txt'), 'KEEP_PERSONAL_FILE')
  $actual = Start-Process -FilePath (Join-Path $fullInstall 'uninstall.exe') -ArgumentList '/S', "_?=$fullInstall" -PassThru
  $owned.Add($actual)
  if (-not $actual.WaitForExit(120000)) { throw 'Actual uninstaller exceeded its deadline' }
  Assert ($actual.ExitCode -eq 0) 'Actual uninstaller failed'
  Assert (-not (Test-Path (Join-Path $fullInstall "$mainName.exe"))) 'Uninstall left the main executable behind'
  Assert (-not (Test-Path (Join-Path $fullInstall 'resources\node.exe'))) 'Uninstall left the companion behind'
  Assert ((Get-Content (Join-Path $fullInstall 'personal.txt') -Raw) -eq 'KEEP_PERSONAL_FILE') 'Uninstall deleted a personal file'

  $a = Compile 'A'; $b = Compile 'B'
  New-Item -ItemType Directory $install | Out-Null
  [IO.File]::WriteAllText((Join-Path $install 'foreign.txt'), 'DO_NOT_MOVE')
  Assert ((Run $a) -ne 0) 'Nonempty first-install parent folder was accepted'
  Assert ((Get-Content (Join-Path $install 'foreign.txt') -Raw) -eq 'DO_NOT_MOVE') 'Non-owned target was moved or deleted'
  Assert (@(Get-ChildItem "$install.octopus-backup-*" -ErrorAction SilentlyContinue).Count -eq 0) 'Foreign target created a backup'
  Remove-Item (Join-Path $install 'foreign.txt')
  Assert ((Run $a) -eq 0) 'Fresh installation failed'; CheckVersion 'A'
  $partial = Compile 'B' @('OCTOPUS_TEST_FAIL_PARTIAL_CLEANUP')
  Assert ((Run $partial) -eq 0) 'Cleanup failure turned a committed installation into failure'
  CheckVersion 'B'
  Assert (-not (Test-Path "$install.octopus-transaction.ini")) 'Committed cleanup failure retained a blocking journal'
  $partialBackups = @(Get-ChildItem "$install.octopus-backup-*" -Directory)
  Assert ($partialBackups.Count -eq 1) 'Injected partial cleanup did not retain its one backup'
  Assert (-not (Test-Path (Join-Path $partialBackups[0].FullName '.octopus-installer-ready.json'))) 'Partial backup still looked valid'
  $currentMarker = Get-Content (Join-Path $install '.octopus-installer-ready.json') -Raw | ConvertFrom-Json
  [IO.File]::WriteAllText((Join-Path $install 'runtime-cache.txt'), 'RUNTIME_WRITE_AFTER_COMMIT')
  Journal $install $partialBackups[0].FullName "$install.octopus-stage-$($currentMarker.token)" 'committed'
  Assert ((Run $a) -eq 0) 'A partially cleaned backup or runtime write poisoned committed recovery'
  CheckVersion 'A'
  Assert (Test-Path $partialBackups[0].FullName) 'Unmarked partial backup was recursively discarded on retry'
  Remove-Item $partialBackups[0].FullName -Recurse
  # The preceding runtime write is retained in the backup, rather than discarded as installer-owned data.
  foreach ($retained in @(Get-ChildItem "$install.octopus-backup-*" -Directory)) {
    Assert (Test-Path (Join-Path $retained.FullName 'runtime-cache.txt')) 'Unexpected retained backup'
    Remove-Item $retained.FullName -Recurse
  }
  $lock = HoldCompanion 2
  Assert ((Run $b) -eq 0) 'Released companion lock did not recover'; CheckVersion 'B'
  $lock.WaitForExit()
  $natural = HoldRunningCompanion 2
  Assert ((Run $a) -eq 0) 'Natural running companion did not release safely'; CheckVersion 'A'
  $natural.WaitForExit()
  $lock = HoldCompanion 120
  $start = [DateTime]::UtcNow
  Assert ((Run $b) -ne 0) 'Permanent companion lock was falsely accepted'
  Assert (([DateTime]::UtcNow - $start).TotalSeconds -lt 35) 'Permanent lock did not stop within budget'
  CheckVersion 'A'; $lock.Kill(); $lock.WaitForExit()
  $failed = Compile 'B' @('OCTOPUS_TEST_FAIL_PUBLISH')
  Assert ((Run $failed) -ne 0) 'Injected publication failure was ignored'; CheckVersion 'A'
  $failedRollback = Compile 'B' @('OCTOPUS_TEST_FAIL_PUBLISH', 'OCTOPUS_TEST_FAIL_ROLLBACK')
  Assert ((Run $failedRollback) -ne 0) 'Injected rollback failure was ignored'
  $journal = "$install.octopus-transaction.ini"
  Assert (Test-Path $journal) 'Recovery journal was lost'
  $backupLine = (Get-Content $journal | Where-Object { $_ -like 'backup=*' })
  $backup = $backupLine.Substring(7)
  Assert ((Get-Content (Join-Path $backup 'resources\version.txt') -Raw) -eq 'A') 'Rollback failure destroyed A'
  Assert ((Run $b) -ne 0) 'Recovery must return an actionable failure before another replacement'
  CheckVersion 'A'
  Assert ((Run $b) -eq 0) 'Upgrade after interrupted recovery failed'; CheckVersion 'B'
  Assert ((Run $b) -eq 0) 'Reinstall failed'; CheckVersion 'B'
  Assert (@(Get-ChildItem "$install.octopus-backup-*" -ErrorAction SilentlyContinue).Count -eq 0) 'Successful upgrades accumulated sealed backups'
  Assert (@(Get-ChildItem "$install.octopus-stage-*" -ErrorAction SilentlyContinue).Count -eq 0) 'Failed attempts accumulated owned staging directories'
  # A writable recovery journal may not redirect moves outside installer-owned siblings.
  $safeBackup = "$install.octopus-backup-900-900"
  $safeStage = "$install.octopus-stage-900-900"
  Move-Item $install $safeBackup
  $foreign = Join-Path $testRoot 'foreign-payload'
  New-Item -ItemType Directory $foreign | Out-Null
  [IO.File]::WriteAllText((Join-Path $foreign 'marker.txt'), 'DO_NOT_MOVE')
  foreach ($badBackup in @($foreign, "$safeBackup\..\foreign-payload")) {
    Journal $install $badBackup $safeStage
    Assert ((Run $b) -ne 0) 'Tampered backup path was accepted'
    Assert (Test-Path "$install.octopus-transaction.ini") 'Rejected journal was silently deleted'
    Assert ((Get-Content (Join-Path $foreign 'marker.txt') -Raw) -eq 'DO_NOT_MOVE') 'Foreign payload changed'
    Assert (Test-Path (Join-Path $safeBackup 'resources\version.txt')) 'Own backup was changed'
  }
  Journal "$install-wrong" $safeBackup $safeStage
  Assert ((Run $b) -ne 0) 'Mismatched target was accepted'
  $junction = "$install.octopus-backup-901-901"
  New-Item -ItemType Junction -Path $junction -Target $foreign | Out-Null
  Journal $install $junction $safeStage
  Assert ((Run $b) -ne 0) 'Reparse backup was accepted'
  & $NodePath -e 'require("fs").unlinkSync(process.argv[1])' $junction
  if ($LASTEXITCODE -ne 0) { throw 'Junction cleanup failed' }
  Remove-Item "$install.octopus-transaction.ini"
  Move-Item $safeBackup $install
  $currentMarker = Get-Content (Join-Path $install '.octopus-installer-ready.json') -Raw | ConvertFrom-Json
  Journal $install "$install.octopus-backup-$($currentMarker.token)" "$install.octopus-stage-$($currentMarker.token)" 'committed'
  Assert ((Run $b) -eq 0) 'Committed leftover journal did not cleanly recover'; CheckVersion 'B'
  $number = 910
  foreach ($state in @('staging','ready','replacing')) {
    $token = "$number-$number"; $number++
    $abandoned = "$install.octopus-stage-$token"
    New-Item -ItemType Directory $abandoned | Out-Null
    [IO.File]::WriteAllText((Join-Path $abandoned 'candidate.txt'), 'OWNED_ABANDONED_STAGE')
    [IO.File]::WriteAllText((Join-Path $abandoned '.octopus-installer-stage.ini'), "[stage]`r`ntoken=$token`r`n")
    Journal $install "$install.octopus-backup-$token" $abandoned $state
    Assert ((Run $b) -eq 0) "Pre-move $state interruption blocked a healthy old installation"
    CheckVersion 'B'
    Assert (-not (Test-Path $abandoned)) 'Owned abandoned candidate was not pruned'
  }
  $token = "$number-$number"; $number++
  $unowned = "$install.octopus-stage-$token"
  New-Item -ItemType Directory $unowned | Out-Null
  [IO.File]::WriteAllText((Join-Path $unowned 'foreign.txt'), 'UNOWNED_STAGE_MUST_REMAIN')
  Journal $install "$install.octopus-backup-$token" $unowned 'staging'
  Assert ((Run $b) -ne 0) 'Unmarked sibling staging was silently discarded'
  Assert ((Get-Content (Join-Path $unowned 'foreign.txt') -Raw) -eq 'UNOWNED_STAGE_MUST_REMAIN') 'Unowned stage was deleted'
  Assert (Test-Path "$install.octopus-transaction.ini") 'Unresolved unowned staging lost its journal'
  Remove-Item "$install.octopus-transaction.ini"
  Remove-Item $unowned -Recurse
  foreach ($tamper in @($false,$true)) {
    $token = "$number-$number"; $number++
    $stage = "$install.octopus-stage-$token"; $backup = "$install.octopus-backup-$token"
    Copy-Item $install $stage -Recurse
    Remove-Item (Join-Path $stage '.octopus-installer-ready.json')
    & powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\desktop-installer-state.ps1') -Operation seal -Root $stage -Token $token
    if ($LASTEXITCODE -ne 0) { throw 'Cannot seal crash fixture' }
    Move-Item $install $backup; Move-Item $stage $install
    Journal $install $backup $stage 'replacing'
    if ($tamper) {
      [IO.File]::AppendAllText((Join-Path $install 'app.exe'), 'MANUAL_EDIT')
      Assert ((Run $b) -ne 0) 'Modified post-publish candidate was accepted'
      Assert ((Get-Content (Join-Path $install 'app.exe') -Raw) -eq 'BMANUAL_EDIT') 'Concurrent edit was overwritten'
      Assert (Test-Path "$install.octopus-transaction.ini") 'Ambiguous journal was discarded'
      Remove-Item $install -Recurse -Force; Move-Item $backup $install
      Remove-Item "$install.octopus-transaction.ini"
    } else {
      Assert ((Run $b) -eq 0) 'Post-publish pre-commit interruption did not recover'
      CheckVersion 'B'
    }
  }

  $companion = Start-Process (Join-Path $install 'resources\node.exe') -ArgumentList '-e', 'setInterval(()=>{},1000)' -PassThru
  $owned.Add($companion); Start-Sleep -Milliseconds 300
  Assert (-not $companion.HasExited) 'Installed companion cannot restart'
  $companion.Kill(); $companion.WaitForExit()
  Assert ((Get-Content (Join-Path $userData 'original.txt') -Raw) -eq 'USER_ORIGINAL_MUST_SURVIVE') 'User data was modified'
  Write-Output 'PASS: full-template compile/install/uninstall, owned-target refusal/cleanup, native A-to-B transient/permanent companion locks, rollback, interrupted recovery, reinstall and restart'
} finally {
  foreach ($p in $owned) { if (-not $p.HasExited) { $p.Kill(); $p.WaitForExit() }; $p.Dispose() }
  Remove-Item -Recurse -Force $testRoot
}
