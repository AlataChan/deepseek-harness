# Native Windows controls execute the production transaction include in compiled NSIS installers.
param([Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
$NodePath = (Resolve-Path $NodePath).Path
if (-not $IsWindows) { throw 'Native Windows is required; this control must not be skipped as a pass' }
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$nsis = Get-ChildItem "$env:LOCALAPPDATA\tauri" -Recurse -Filter makensis.exe | Select-Object -First 1
if (-not $nsis) { throw 'Pinned Tauri NSIS must be installed by build-exe first' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('octopus-upgrade-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
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
try {
  $a = Compile 'A'; $b = Compile 'B'
  Assert ((Run $a) -eq 0) 'Fresh installation failed'; CheckVersion 'A'
  $lock = HoldCompanion 2
  Assert ((Run $b) -eq 0) 'Released companion lock did not recover'; CheckVersion 'B'
  $lock.WaitForExit()
  Assert ((Run $a) -eq 0) 'A reinstall failed'; CheckVersion 'A'
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
  $companion = Start-Process (Join-Path $install 'resources\node.exe') -ArgumentList '-e', 'setInterval(()=>{},1000)' -PassThru
  $owned.Add($companion); Start-Sleep -Milliseconds 300
  Assert (-not $companion.HasExited) 'Installed companion cannot restart'
  $companion.Kill(); $companion.WaitForExit()
  Assert ((Get-Content (Join-Path $userData 'original.txt') -Raw) -eq 'USER_ORIGINAL_MUST_SURVIVE') 'User data was modified'
  Write-Output 'PASS: native A-to-B transient/permanent companion locks, rollback, interrupted recovery, reinstall and restart'
} finally {
  foreach ($p in $owned) { if (-not $p.HasExited) { $p.Kill(); $p.WaitForExit() }; $p.Dispose() }
  Remove-Item -Recurse -Force $testRoot
}
