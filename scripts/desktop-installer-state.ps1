# Trusted installer helper: hash files without loading candidate code or following reparse points.
param([ValidateSet('seal','verify','recognize','clean-stage','clean-backup')][string]$Operation, [string]$Root, [string]$Token)
$ErrorActionPreference = 'Stop'
$markerName = '.octopus-installer-ready.json'
if (-not $Root -or ($Operation -ne 'recognize' -and $Token -notmatch '^[0-9]+-[0-9]+$')) { throw 'Invalid installer state identity' }
$cleanup = $Operation -in @('clean-stage','clean-backup')
if ($cleanup -and -not (Test-Path -LiteralPath $Root)) { return }
if ($cleanup) {
  $kind = if ($Operation -eq 'clean-stage') { 'stage' } else { 'backup' }
  if (-not $Root.EndsWith(".octopus-$kind-$Token", [StringComparison]::Ordinal)) { throw 'Cleanup root is not the transaction sibling' }
}
$rootInfo = [IO.DirectoryInfo]::new($Root)
if (-not $rootInfo.Exists -or ($rootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe payload root' }
if ($Operation -eq 'recognize') {
  if ($rootInfo.GetFileSystemInfos().Count -eq 0) { return }
  $marker = Join-Path $Root $markerName
  if (([IO.FileInfo]::new($marker)).Length -gt 4096) { throw 'Invalid installer marker' }
  $record = [IO.File]::ReadAllText($marker) | ConvertFrom-Json
  if ($record.schemaVersion -ne 1 -or $record.token -notmatch '^[0-9]+-[0-9]+$' -or $record.sha256 -notmatch '^[0-9a-f]{64}$') { throw 'Invalid installer marker identity' }
  return
}
if ($Operation -eq 'clean-backup' -and -not [IO.File]::Exists((Join-Path $Root $markerName))) {
  Write-Output 'Legacy backup retained for explicit recovery'
  return
}
$paths = [Collections.Generic.List[string]]::new()
$directories = [Collections.Generic.List[string]]::new()
function Collect([IO.DirectoryInfo]$Directory) {
  foreach ($item in $Directory.GetFileSystemInfos()) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Payload reparse points are refused' }
    if ($item -is [IO.DirectoryInfo]) { $directories.Add($item.FullName); Collect $item }
    elseif ($item.FullName -ne (Join-Path $Root $markerName)) { $paths.Add($item.FullName) }
  }
}
Collect $rootInfo
if ($Operation -eq 'clean-stage') {
  $owner = Join-Path $Root '.octopus-installer-stage.ini'
  if (-not [IO.File]::Exists($owner) -or ([IO.FileInfo]::new($owner)).Length -gt 256) { throw 'Unmarked staging is retained' }
  $identity = [IO.File]::ReadAllText($owner)
  if ($identity -notmatch ('(?m)^token=' + [Regex]::Escape($Token) + '\r?$')) { throw 'Foreign staging is retained' }
  # Collect rejected every reparse point before deletion; never follow links during cleanup.
  foreach ($path in $paths) { [IO.File]::Delete($path) }
  $directories.Sort([StringComparer]::Ordinal)
  for ($i = $directories.Count - 1; $i -ge 0; $i--) { [IO.Directory]::Delete($directories[$i]) }
  [IO.File]::Delete((Join-Path $Root $markerName))
  [IO.Directory]::Delete($rootInfo.FullName)
  Write-Output 'owned-stage-removed'
  return
}
$paths.Sort([StringComparer]::Ordinal)
$text = [Text.StringBuilder]::new()
$directories.Sort([StringComparer]::Ordinal)
foreach ($path in $directories) {
  $relative = $path.Substring($rootInfo.FullName.TrimEnd('\').Length + 1).Replace('\','/')
  [void]$text.Append('D').Append([char]0).Append($relative).Append("`n")
}
foreach ($path in $paths) {
  $stream = [IO.File]::OpenRead($path)
  try { $hash = [Security.Cryptography.SHA256]::Create(); try { $bytes = $hash.ComputeHash($stream) } finally { $hash.Dispose() } }
  finally { $stream.Dispose() }
  $relative = $path.Substring($rootInfo.FullName.TrimEnd('\').Length + 1).Replace('\','/')
  [void]$text.Append('F').Append([char]0).Append($relative).Append([char]0).Append(([IO.FileInfo]::new($path)).Length).Append([char]0).Append([BitConverter]::ToString($bytes)).Append("`n")
}
$hash = [Security.Cryptography.SHA256]::Create()
try { $digest = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($text.ToString()))).Replace('-','').ToLowerInvariant() }
finally { $hash.Dispose() }
$marker = Join-Path $Root $markerName
if ($Operation -eq 'seal') {
  $record = @{ schemaVersion = 1; token = $Token; sha256 = $digest } | ConvertTo-Json -Compress
  $temporary = "$marker.$([Guid]::NewGuid().ToString('N')).tmp"
  $stream = [IO.FileStream]::new($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $data = [Text.Encoding]::UTF8.GetBytes($record); $stream.Write($data, 0, $data.Length); $stream.Flush($true) }
  finally { $stream.Dispose() }
  [IO.File]::Move($temporary, $marker)
} else {
  if (([IO.FileInfo]::new($marker)).Length -gt 4096) { throw 'Invalid installer marker' }
  $record = [IO.File]::ReadAllText($marker) | ConvertFrom-Json
  if ($record.token -notmatch '^[0-9]+-[0-9]+$') { throw 'Invalid installer marker identity' }
  if ($record.schemaVersion -ne 1 -or ($Operation -eq 'verify' -and $record.token -ne $Token) -or $record.sha256 -cne $digest) { throw 'Payload changed since staging' }
}
if ($Operation -eq 'clean-backup') {
  # Retire the validity marker before destructive cleanup; partial leftovers are never reusable payloads.
  [IO.File]::Delete($marker)
  foreach ($path in $paths) { [IO.File]::Delete($path) }
  for ($i = $directories.Count - 1; $i -ge 0; $i--) { [IO.Directory]::Delete($directories[$i]) }
  [IO.Directory]::Delete($rootInfo.FullName)
}
Write-Output 'payload-state-ok'
