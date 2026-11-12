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
    # Start-Process -Credential inherits the caller's environment on the runner.
    $profileKey = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$($identity.User.Value)"
    $profile = (Get-ItemProperty -LiteralPath $profileKey).ProfileImagePath
    if (-not (Test-Path -LiteralPath $profile -PathType Container)) { throw 'The test account profile was not loaded.' }
    $local = Join-Path $profile 'AppData\Local'
    $env:USERPROFILE = $profile
    $env:LOCALAPPDATA = $local
    $env:APPDATA = Join-Path $profile 'AppData\Roaming'
    $env:TEMP = Join-Path $local 'Temp'
    $env:TMP = $env:TEMP
    New-Item -ItemType Directory -Force -Path $env:APPDATA, $env:TEMP | Out-Null
    $path = Join-Path $local 'HMP bêta avec espaces'
    $report.webView2 = 'present'
    $report.installerSignature = (Get-AuthenticodeSignature -FilePath $Installer).Status.ToString()

    $setup = Start-Process $Installer -ArgumentList "/S /D=$path" -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "Per-user install failed (exit $($setup.ExitCode))." }
    $entries = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' |
        Where-Object DisplayName -eq 'HyperDeck Media Puller V2 Preview')
    if ($entries.Count -ne 1) { throw 'Expected one HMP uninstall entry in HKCU.' }
    $entry = $entries[0]
    if ($entry.DisplayVersion -ne $Version) { throw "Unexpected installed version: $($entry.DisplayVersion)" }
    $installedPath = $entry.InstallLocation.Trim('"')
    if ($installedPath -ne $path) { throw "Unexpected installed directory: $installedPath" }
    $exe = Join-Path $installedPath $entry.MainBinaryName
    $uninstaller = $entry.UninstallString.Trim('"')
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -or -not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
        throw "Missing binary or uninstaller in the registered directory: $installedPath"
    }
    $report.installedBinary = $entry.MainBinaryName
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
