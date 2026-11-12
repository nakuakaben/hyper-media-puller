param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$Version
)

$ErrorActionPreference = 'Stop'
$report = [ordered]@{ version = $Version }
$app = $null
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $report.standardUser = -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $report.standardUser) { throw 'The test must run as a standard user.' }
    $local = [Environment]::GetFolderPath('LocalApplicationData')
    if ([string]::IsNullOrEmpty($local)) { throw 'No local application data directory for the test account.' }
    $env:LOCALAPPDATA = $local
    $env:APPDATA = [Environment]::GetFolderPath('ApplicationData')
    $path = Join-Path $local 'HMP bêta avec espaces'
    $exe = Join-Path $path 'hmp-v2-preview.exe'
    $report.webView2 = 'present'
    $report.installerSignature = (Get-AuthenticodeSignature -FilePath $Installer).Status.ToString()

    $setup = Start-Process $Installer -ArgumentList "/S /D=$path" -Wait -PassThru
    if ($setup.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $exe)) {
        throw "Per-user install failed (exit $($setup.ExitCode))."
    }
    $uninstallEntry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' |
        Where-Object { $_.DisplayVersion -eq $Version -and $_.UninstallString -like "*$path*" }
    if (-not $uninstallEntry) { throw 'Expected a versioned per-user uninstall entry.' }
    $report.installed = $true
    $report.applicationSignature = (Get-AuthenticodeSignature -FilePath $exe).Status.ToString()

    $app = Start-Process $exe -WorkingDirectory $path -PassThru
    $deadline = (Get-Date).AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 250
        $app.Refresh()
    } until ($app.HasExited -or $app.MainWindowHandle -ne 0 -or (Get-Date) -ge $deadline)
    if ($app.HasExited -or $app.MainWindowHandle -eq 0) { throw 'The installed application did not show a window.' }
    $report.launched = $true
    if (-not $app.CloseMainWindow() -or -not $app.WaitForExit(15000) -or $app.ExitCode -ne 0) {
        throw 'The installed application did not close normally.'
    }

    $uninstaller = Join-Path $path 'uninstall.exe'
    $remove = Start-Process $uninstaller -ArgumentList '/S' -Wait -PassThru
    if ($remove.ExitCode -ne 0 -or (Test-Path -LiteralPath $exe)) { throw 'Uninstall did not remove the application.' }
    $report.uninstalled = $true
} catch {
    $report.error = $_.Exception.Message
    throw
} finally {
    if ($null -ne $app -and -not $app.HasExited) { $app.Kill() }
    $report | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path (Split-Path $Installer) 'windows-package.json')
}
