$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $projectRoot 'extension'
$manifest = Get-Content -Raw -LiteralPath (Join-Path $extensionRoot 'manifest.json') | ConvertFrom-Json
$archive = Join-Path $projectRoot "public/shotprint-extension-$($manifest.version).zip"
$compatArchive = Join-Path $extensionRoot 'shotprint-extension.zip'
$files = @('manifest.json','background.js','site-bridge.js','collector.js','media.js','INSTALL.md') | ForEach-Object { Join-Path $extensionRoot $_ }
Compress-Archive -LiteralPath $files -DestinationPath $archive -Force
$bytes = [IO.File]::ReadAllBytes($archive)
[IO.File]::WriteAllText("$archive.b64", [Convert]::ToBase64String($bytes))
[IO.File]::WriteAllText("$archive.sha256", (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant())
[IO.File]::WriteAllBytes($compatArchive, $bytes)
[IO.File]::WriteAllText("$compatArchive.sha256", (Get-FileHash -LiteralPath $compatArchive -Algorithm SHA256).Hash.ToLowerInvariant())
Write-Output "Packaged extension $($manifest.version) ($($bytes.Length) bytes)"
