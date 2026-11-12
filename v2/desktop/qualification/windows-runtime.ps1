$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Use an isolated Windows runner' }

function Find-WebViewRuntime {
  $directories = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\EdgeWebView\Application')
  )
  Get-ChildItem $directories -Recurse -Filter msedgewebview2.exe -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

$runtime = Find-WebViewRuntime
if (!$runtime) {
  $installer = Join-Path $env:RUNNER_TEMP 'MicrosoftEdgeWebView2Setup.exe'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $installer
  $signature = Get-AuthenticodeSignature $installer
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
    throw 'Unverified Microsoft WebView2 installer'
  }
  $process = Start-Process $installer -ArgumentList '/silent /install' -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "WebView2 Runtime installation failed: $($process.ExitCode)" }
  $runtime = Find-WebViewRuntime
}
if (!$runtime) { throw 'WebView2 Runtime executable is missing' }
Write-Output ("WebView2 Runtime " + $runtime.VersionInfo.ProductVersion)
Add-Content -Path $env:GITHUB_ENV -Value ("HMP_WEBVIEW2_RUNTIME=" + $runtime.DirectoryName)
Add-Content -Path $env:GITHUB_ENV -Value ("HMP_WEBVIEW2_VERSION=" + $runtime.VersionInfo.ProductVersion)
