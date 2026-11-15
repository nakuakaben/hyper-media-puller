param(
    [Parameter(Mandatory)][string]$Binary,
    [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# HMP portable packages are unsigned development artifacts. Studio App must
# independently pin and approve their immutable SHA-256 before installation.
$desktop = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repo = (Resolve-Path (Join-Path $desktop '../..')).Path
$binaryPath = (Resolve-Path -LiteralPath $Binary).Path
if ([IO.Path]::GetFileName($binaryPath) -cne 'hmp-v2-preview.exe') {
    throw 'Unexpected Tauri binary. Expected hmp-v2-preview.exe.'
}
if (-not (Test-Path -LiteralPath $binaryPath -PathType Leaf)) {
    throw 'HMP executable is missing.'
}
$version = (Get-Content -LiteralPath (Join-Path $desktop 'package.json') -Raw | ConvertFrom-Json).version
if ($version -cnotmatch '^0\\.[0-9]+\\.[0-9]+-beta\\.[0-9]+$') {
    throw 'A versioned beta package is required.'
}
$releaseName = "HMP-V2-$version-windows-x64-portable.zip"
$outputDir = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$zip = Join-Path $outputDir $releaseName
$manifestPath = Join-Path $outputDir 'SHA256SUMS-portable.txt'
if ((Test-Path -LiteralPath $zip) -or (Test-Path -LiteralPath $manifestPath)) {
    throw 'Refusing to overwrite an existing portable archive or digest.'
}
$staging = Join-Path $env:RUNNER_TEMP ("hmp-portable-" + [Guid]::NewGuid().ToString('N'))
$package = Join-Path $staging 'HMP'
try {
    New-Item -ItemType Directory -Force -Path $package | Out-Null
    Copy-Item -LiteralPath $binaryPath -Destination (Join-Path $package 'hmp-v2-preview.exe')
    $licenses = Join-Path $package 'licenses'
    New-Item -ItemType Directory -Force -Path $licenses | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'LICENSE') -Destination (Join-Path $licenses 'HMP-MIT.txt')
    # Respect Tauri's resource layout. Do not put any user-specific data here.
    Copy-Item -Path (Join-Path $desktop 'licenses/*') -Destination $licenses -Recurse
    $files = @(Get-ChildItem -LiteralPath $package -Recurse -File)
    if ($files.Count -lt 2 -or -not (Test-Path (Join-Path $package 'licenses/HMP-MIT.txt'))) {
        throw 'Portable stage is missing application resources.'
    }
    $manifest = [ordered]@{
        schemaVersion = 1
        appId = 'hyper-media-puller'
        profile = 'fr.tktprod.hyperdeck-media-puller.v2.preview'
        version = $version
        platform = 'windows'
        architecture = 'x86_64'
        executable = 'hmp-v2-preview.exe'
        requiresWebView2Evergreen = $true
        files = @($files | Sort-Object FullName | ForEach-Object {
            @{
                path = $_.FullName.Substring($package.Length + 1).Replace('\\','/')
                size = $_.Length
                sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        })
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $package 'studio-portable.json') -Encoding utf8
    Compress-Archive -LiteralPath $package -DestinationPath $zip -CompressionLevel Optimal
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($manifestPath, "$hash  $releaseName`n")
    Write-Host "Portable package: $zip"
    Write-Host "SHA-256: $hash"
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Force -Recurse }
}
