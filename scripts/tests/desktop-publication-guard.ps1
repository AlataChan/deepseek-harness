# Native negative control: unsigned, internal, malformed and tampered downloads never run an installer marker.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Native Windows is required' }
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$nsis = Get-ChildItem "$env:LOCALAPPDATA\tauri" -Recurse -Filter makensis.exe | Select-Object -First 1
if (-not $nsis) { throw 'NSIS is required' }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('octopus-publish-guard-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory $temp
$null = New-Item -ItemType Junction -Path (Join-Path $temp 'scripts') -Target (Join-Path $root 'scripts')
$null = New-Item -ItemType Junction -Path (Join-Path $temp 'node_modules') -Target (Join-Path $root 'node_modules')
$candidate = Join-Path $temp 'candidate'; $null = New-Item -ItemType Directory $candidate
$exe = Join-Path $candidate 'octopus-1.2.3-windows-x64.exe'; $marker = Join-Path $temp 'UNEXPECTED_EXECUTION'
$nsi = Join-Path $temp 'marker.nsi'
[IO.File]::WriteAllText($nsi, @"
Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "$exe"
Section
FileOpen `$0 "$marker" w
FileWrite `$0 "EXECUTED"
FileClose `$0
SectionEnd
"@)
& $nsis.FullName /V2 $nsi | Write-Host
if ($LASTEXITCODE -ne 0) { throw 'Marker compile failed' }
$commit = 'a' * 40
$base = @{ schemaVersion=1; mode='public'; sourceState=@{modifiedAtBuild=$false;modifiedAtPackaging=$false}; repository='AlataChan/deepseek-harness'; ref='refs/heads/release';
  release=@{version='1.2.3';commit=$commit}; shellVersion='1.2.3'; target='windows-x64'; payloadSha256=('b' * 64);
  artifact=@{name=(Split-Path -Leaf $exe); bytes=(Get-Item $exe).Length; sha256=(Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()};
  workflow=@{path='.github/workflows/desktop-windows.yml';commit=$commit;runId=123;attempt=2;artifactName='build-123-2'} }
$env:DSH_EXPECTED_SOURCE_COMMIT=$commit; $env:DSH_EXPECTED_SOURCE_RUN='123'; $env:DSH_EXPECTED_SOURCE_ATTEMPT='2'
$env:DSH_RELEASE_TARGET='windows-x64'; $env:DSH_RELEASE_OPERATION='plan'; $env:DSH_RELEASE_CHANNEL='stable-windows-x64'
$env:DSH_WINDOWS_PUBLISHER='CN=Synthetic Publisher'; $env:GH_TOKEN='synthetic-read-only'
Push-Location $temp
try {
  foreach ($kind in @('internal','invalid-schema','tampered-hash','unsafe-name','unsigned')) {
    $record = $base | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    switch ($kind) {
      internal { $record.mode='internal' }
      invalid-schema { $record.schemaVersion=999 }
      tampered-hash { $record.artifact.sha256='c' * 64 }
      unsafe-name { $record.artifact.name='../outside.exe' }
    }
    $record | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $candidate 'installer.release.json') -Encoding utf8
    $output = & pwsh -NoProfile -File (Join-Path $root 'scripts/tests/desktop-publication-native.ps1') 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    $output | Write-Host
    $reason = switch ($kind) {
      internal { 'Internal artifacts cannot enter public qualification' }
      invalid-schema { 'Unsupported manifest version or mode' }
      tampered-hash { 'Downloaded installer differs from its manifest' }
      unsafe-name { 'Invalid artifact identity' }
      unsigned { 'Authenticode verification failed' }
    }
    if (-not $output.Contains($reason)) { throw "$kind was rejected for the wrong reason; expected $reason" }
    if ($exitCode -eq 0) { throw "$kind candidate was accepted" }
    if (Test-Path $marker) { throw "$kind candidate executed before qualification" }
  }
  Write-Output 'PASS: all invalid download cases refused before installer marker execution'
} finally {
  Pop-Location
  # Unlink junctions before recursively deleting only this owned scratch directory.
  node -e 'for(const p of process.argv.slice(1))require("fs").unlinkSync(p)' (Join-Path $temp 'scripts') (Join-Path $temp 'node_modules')
  Remove-Item $temp -Recurse -Force
}
