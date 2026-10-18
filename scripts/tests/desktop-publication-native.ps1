# Publication runs native verification on disposable installs, never a user installation.
$ErrorActionPreference = 'Stop'
$manifests = @(Get-ChildItem candidate -Filter '*.release.json')
if ($manifests.Count -ne 1) { throw 'Expected exactly one artifact manifest' }
$validated = & node --import tsx/esm scripts/desktop-release-cli.ts inspect-download $manifests[0].FullName
if ($LASTEXITCODE -ne 0) { throw 'Downloaded manifest failed strict public validation' }
$manifest = $validated | ConvertFrom-Json
$artifact = Join-Path $manifests[0].DirectoryName $manifest.artifact.name
& node --import tsx/esm scripts/desktop-release-cli.ts qualify-download $manifests[0].FullName $artifact $env:DSH_EXPECTED_SOURCE_COMMIT $env:DSH_EXPECTED_SOURCE_RUN $env:DSH_EXPECTED_SOURCE_ATTEMPT $env:DSH_RELEASE_TARGET
if ($LASTEXITCODE -ne 0) { throw 'Downloaded artifact refused before any candidate code execution' }
function Invoke-Scrubbed([scriptblock]$Action) {
  $saved = @{}
  foreach ($entry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) {
    if ($entry.Key -match 'KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION') {
      $saved[$entry.Key] = $entry.Value
      [Environment]::SetEnvironmentVariable($entry.Key, $null, 'Process')
    }
  }
  try { & $Action } finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
  }
}
$plan = Join-Path $manifests[0].DirectoryName 'publication-plan.json'
if ($env:DSH_RELEASE_OPERATION -ne 'plan') {
  if (-not $env:DSH_REVIEWED_PLAN) { throw 'Reviewed plan JSON is required' }
  [IO.File]::WriteAllText($plan, $env:DSH_REVIEWED_PLAN, [Text.UTF8Encoding]::new($false))
}
$install = Join-Path ([IO.Path]::GetTempPath()) ('octopus-publication-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$mount = $null
try {
  if ($IsWindows) {
    Invoke-Scrubbed {
      $p = Start-Process $artifact -ArgumentList '/S', "/D=$install" -Wait -PassThru
      if ($p.ExitCode -ne 0) { throw "Disposable installer returned $($p.ExitCode)" }
    }
    $payload = Join-Path $install 'resources'
    $env:DSH_SIGNATURE_PAYLOAD = Join-Path $install 'dsh-desktop.exe'
    Invoke-Scrubbed {
      node scripts/verify-desktop-exe.mjs $install
      if ($LASTEXITCODE -ne 0) { throw 'Installed Windows readiness failed' }
    }
  } else {
    New-Item -ItemType Directory $install | Out-Null
    hdiutil attach -readonly -nobrowse -mountpoint $install $artifact
    if ($LASTEXITCODE -ne 0) { throw 'Read-only DMG mount failed' }
    $mount = $install
    $app = Join-Path $install 'octopus_DSH.app'
    $env:DSH_SIGNATURE_PAYLOAD = $app
    $payload = Join-Path $app 'Contents/Resources/resources'
    Invoke-Scrubbed {
      bash scripts/verify-desktop-bundle.sh $app
      if ($LASTEXITCODE -ne 0) { throw 'Mounted desktop verification failed' }
    }
  }
  if ($env:DSH_RELEASE_OPERATION -eq 'publish') { throw 'Write publication is forbidden in the read-only native qualification job' }
  node --import tsx/esm scripts/desktop-release-cli.ts $env:DSH_RELEASE_OPERATION $manifests[0].FullName $artifact $payload $plan $env:DSH_RELEASE_CHANNEL $env:DSH_SIGNATURE_PAYLOAD
  if ($LASTEXITCODE -ne 0) { throw 'Desktop publication operation failed' }
} finally {
  if ($mount) { hdiutil detach $mount; if ($LASTEXITCODE -ne 0) { throw 'DMG detach failed; mount retained for recovery' } }
  if (Test-Path $install) { Remove-Item $install -Recurse -Force }
}
