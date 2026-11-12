param([Parameter(Mandatory)][string]$Recipient)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ARCH -ne 'X64') {
    throw 'This qualification requires a disposable GitHub Actions Windows x64 runner.'
}
if ($Recipient -cnotmatch '^age1[0-9a-z]{58}$') {
    throw 'Expected a single age X25519 recipient.'
}

$root = Join-Path $env:PUBLIC ("hmp-beta-" + [guid]::NewGuid().ToString('N'))
$account = 'hmp-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$output = Join-Path $env:RUNNER_TEMP 'hmp-beta-windows'
$version = (Get-Content ./package.json -Raw | ConvertFrom-Json).version
$name = "HMP-V2-$version-windows-x64-setup.exe"
$ageZip = Join-Path $root 'age.zip'
$ageHash = 'f48d8f8f9ebe903ab5027ed067652f2cc1db94bc206976430133b905dcd8e8c7'
New-Item -ItemType Directory -Path $root, $output | Out-Null
try {
    npm run tauri -- build --ci --target x86_64-pc-windows-msvc --bundles nsis -- --locked
    if ($LASTEXITCODE -ne 0) { throw 'The NSIS build failed.' }

    $packages = @(Get-ChildItem src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis -Filter '*-setup.exe')
    if ($packages.Count -ne 1 -or $packages[0].Name -notlike "*$version*") {
        throw 'Expected exactly one NSIS installer for the requested version.'
    }
    $installer = Join-Path $root $name
    Copy-Item $packages[0].FullName $installer
    Copy-Item "$PSScriptRoot/windows-package-user.ps1" $root
    $password = ConvertTo-SecureString ("Hmp!4" + [guid]::NewGuid().ToString('N')) -AsPlainText -Force
    $user = New-LocalUser -Name $account -Password $password -Description 'Disposable HMP NSIS qualification'
    $users = Get-LocalGroup -SID 'S-1-5-32-545'
    if (-not (Get-LocalGroupMember -Group $users | Where-Object SID -eq $user.SID)) {
        Add-LocalGroupMember -Group $users -Member $user
    }
    & icacls.exe $root /grant "*$($user.SID):(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot grant the test account access to its fixture.' }

    $credential = [pscredential]::new("$env:COMPUTERNAME\$account", $password)
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}\windows-package-user.ps1" -Installer "{1}" -Version {2}' -f $root, $installer, $version
    $parameters = @{
        FilePath = (Get-Command pwsh).Source
        Credential = $credential
        LoadUserProfile = $true
        ArgumentList = $arguments
        WorkingDirectory = $root
        PassThru = $true
    }
    $test = Start-Process @parameters
    if (-not $test.WaitForExit(180000)) {
        $test.Kill()
        throw 'The standard-user installer test exceeded three minutes.'
    }
    $report = Join-Path $root 'windows-package.json'
    if (Test-Path $report) { Get-Content $report }
    if ($test.ExitCode -ne 0 -or -not (Test-Path $report)) { throw 'Standard-user installer test failed.' }

    $hash = (Get-FileHash -Algorithm SHA256 $installer).Hash.ToLowerInvariant()
    Set-Content -Encoding ascii (Join-Path $root 'SHA256SUMS.txt') "$hash  $name"
    Set-Content -Encoding ascii (Join-Path $root 'COMMIT.txt') (git rev-parse HEAD)
    $archive = Join-Path $root 'windows-package.zip'
    Compress-Archive -Path $installer, $report, (Join-Path $root 'SHA256SUMS.txt'), (Join-Path $root 'COMMIT.txt') -DestinationPath $archive

    Invoke-WebRequest -Uri 'https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-windows-amd64.zip' -OutFile $ageZip
    if ((Get-FileHash -Algorithm SHA256 $ageZip).Hash -ne $ageHash) { throw 'Unexpected age archive hash.' }
    Expand-Archive $ageZip -DestinationPath $root
    & "$root/age/age.exe" --encrypt --recipient $Recipient --output "$output/windows-package.zip.age" $archive
    if ($LASTEXITCODE -ne 0) { throw 'Encrypting the installer artifact failed.' }
} finally {
    if (Get-LocalUser -Name $account -ErrorAction SilentlyContinue) { Remove-LocalUser -Name $account }
    Remove-Item -LiteralPath $root -Force -Recurse
}
