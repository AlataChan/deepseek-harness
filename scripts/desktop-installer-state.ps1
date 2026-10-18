# Trusted installer helper: hash files without loading candidate code or following reparse points.
param([ValidateSet('seal','verify')][string]$Operation, [string]$Root, [string]$Token)
$ErrorActionPreference = 'Stop'
$markerName = '.octopus-installer-ready.json'
if (-not $Root -or $Token -notmatch '^[0-9]+-[0-9]+$') { throw 'Invalid installer state identity' }
$rootInfo = [IO.DirectoryInfo]::new($Root)
if (-not $rootInfo.Exists -or ($rootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe payload root' }
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
  if ($record.schemaVersion -ne 1 -or $record.token -ne $Token -or $record.sha256 -cne $digest) { throw 'Payload changed since staging' }
}
Write-Output 'payload-state-ok'
