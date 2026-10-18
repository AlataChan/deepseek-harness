# Publication runs native verification on disposable installs, never a user installation.
$ErrorActionPreference = 'Stop'
$manifests = @(Get-ChildItem candidate -Filter '*.release.json')
if ($manifests.Count -ne 1) { throw 'Expected exactly one artifact manifest' }
$manifest = Get-Content $manifests[0].FullName -Raw | ConvertFrom-Json
if ($manifest.release.commit -ne $env:DSH_EXPECTED_SOURCE_COMMIT -or $manifest.workflow.runId.ToString() -ne $env:DSH_EXPECTED_SOURCE_RUN -or $manifest.workflow.attempt.ToString() -ne $env:DSH_EXPECTED_SOURCE_ATTEMPT -or $manifest.target -ne $env:DSH_RELEASE_TARGET) { throw 'Downloaded artifact differs from explicitly selected source/run/attempt/target' }
$artifact = Join-Path $manifests[0].DirectoryName $manifest.artifact.name
$plan = Join-Path $manifests[0].DirectoryName 'publication-plan.json'
if ($env:DSH_RELEASE_OPERATION -ne 'plan') {
  if (-not $env:DSH_REVIEWED_PLAN) { throw 'Reviewed plan JSON is required' }
  [IO.File]::WriteAllText($plan, $env:DSH_REVIEWED_PLAN)
}
$install = Join-Path ([IO.Path]::GetTempPath()) ('octopus-publication-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$mount = $null
try {
  if ($IsWindows) {
    $p = Start-Process $artifact -ArgumentList '/S', "/D=$install" -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Disposable installer returned $($p.ExitCode)" }
    $payload = Join-Path $install 'resources'
    $env:DSH_SIGNATURE_PAYLOAD = Join-Path $install 'dsh-desktop.exe'
    node scripts/verify-desktop-exe.mjs $install
    if ($LASTEXITCODE -ne 0) { throw 'Installed Windows readiness failed' }
  } else {
    New-Item -ItemType Directory $install | Out-Null
    hdiutil attach -readonly -nobrowse -mountpoint $install $artifact
    if ($LASTEXITCODE -ne 0) { throw 'Read-only DMG mount failed' }
    $mount = $install
    $app = Join-Path $install 'octopus_DSH.app'
    $env:DSH_SIGNATURE_PAYLOAD = $app
    $payload = Join-Path $app 'Contents/Resources/resources'
    bash scripts/verify-desktop-bundle.sh $app
    if ($LASTEXITCODE -ne 0) { throw 'Mounted desktop verification failed' }
  }
  if ($env:DSH_RELEASE_OPERATION -eq 'publish') { $env:DSH_CONFIRM_PUBLISH = "AlataChan/deepseek-harness:$($env:DSH_RELEASE_CHANNEL):$($manifest.release.commit)" }
  node --import tsx/esm scripts/desktop-release-cli.ts $env:DSH_RELEASE_OPERATION $manifests[0].FullName $artifact $payload $plan $env:DSH_RELEASE_CHANNEL
  if ($LASTEXITCODE -ne 0) { throw 'Desktop publication operation failed' }
} finally {
  if ($mount) { hdiutil detach $mount; if ($LASTEXITCODE -ne 0) { throw 'DMG detach failed; mount retained for recovery' } }
  if (Test-Path $install) { Remove-Item $install -Recurse -Force }
}
