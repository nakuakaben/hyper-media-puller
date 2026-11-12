param(
  [Parameter(Mandatory)][string]$Probe,
  [Parameter(Mandatory)][string]$Evidence
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Use an isolated Windows runner' }
$root = Join-Path $env:RUNNER_TEMP ('hmp-vhd-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$null = New-Item -ItemType Directory -Force -Path $Evidence
$Probe = (Resolve-Path $Probe).Path
$Evidence = (Resolve-Path $Evidence).Path
$checks = [ordered]@{}

function Invoke-DiskPart([string[]]$Instructions) {
  $scriptPath = Join-Path $root 'diskpart.txt'
  $Instructions | Set-Content -Path $scriptPath -Encoding ascii
  $output = & diskpart.exe /s $scriptPath | Out-String
  if ($LASTEXITCODE -ne 0) { throw $output }
  return $output
}
function Get-TestDisk([string]$Image) {
  $mounted = Get-DiskImage -ImagePath $Image
  if (!$mounted.Attached -or $mounted.Size -gt 128MB) { throw 'Disposable image not mounted or too large' }
  $disk = $mounted | Get-Disk
  if (!$disk -or $disk.IsBoot -or $disk.IsSystem) { throw 'Unexpected disk for temporary image' }
  return $disk
}
function New-TestVolume([string]$Image, [string]$FileSystem, [string]$Label) {
  if (Test-Path $Image) { throw 'Image path must be new' }
  $null = Invoke-DiskPart @("create vdisk file=`"$Image`" maximum=96 type=expandable", "select vdisk file=`"$Image`"", 'attach vdisk')
  $disk = Get-TestDisk $Image
  Initialize-Disk -Number $disk.Number -PartitionStyle MBR
  $partition = New-Partition -DiskNumber $disk.Number -UseMaximumSize -AssignDriveLetter
  $volume = Format-Volume -Partition $partition -FileSystem $FileSystem -NewFileSystemLabel $Label -Confirm:$false
  if ($volume.FileSystemLabel -ne $Label -or $volume.FileSystem -ne $FileSystem) { throw 'Unexpected test volume' }
  return [string]$volume.DriveLetter + ':\'
}
function Remove-TestImage([string]$Image) {
  if (Test-Path $Image) {
    $mounted = Get-DiskImage -ImagePath $Image -ErrorAction SilentlyContinue
    if ($mounted.Attached) { Dismount-DiskImage -ImagePath $Image | Out-Null }
  }
}
function Invoke-Probe([string]$Mode, [string]$Path) {
  $output = & $Probe $Mode $Path 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw $output }
  return $output.Trim()
}

$fullImage = Join-Path $root 'full.vhd'
$removeImage = Join-Path $root 'remove.vhd'
$exfatImage = Join-Path $root 'exfat.vhd'
try {
  $full = New-TestVolume $fullImage NTFS 'HMPFULL'
  $checks.ntfs_full = Invoke-Probe full $full
  Remove-TestImage $fullImage

  $exfat = $null
  try { $exfat = New-TestVolume $exfatImage exFAT 'HMPEXFAT' }
  catch { $checks.exfat_unavailable = $_.Exception.Message }
  if ($exfat) { $checks.exfat = Invoke-Probe exfat $exfat }
  Remove-TestImage $exfatImage

  $removal = New-TestVolume $removeImage NTFS 'HMPREMOVE'
  $marker = Join-Path $root 'ready'
  $outputFile = Join-Path $root 'remove-output.txt'
  $errorFile = Join-Path $root 'remove-error.txt'
  $child = Start-Process -FilePath $Probe -ArgumentList ('remove "{0}." "{1}"' -f $removal, $marker) -PassThru -RedirectStandardOutput $outputFile -RedirectStandardError $errorFile
  try {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while (!(Test-Path $marker) -and !$child.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (!(Test-Path $marker)) { throw "Volume probe did not start: $(Get-Content $errorFile -Raw)" }
    $volume = Get-Volume -DriveLetter $removal[0]
    if ($volume.FileSystemLabel -ne 'HMPREMOVE') { throw 'Refusing to dismount an unexpected volume' }
    $disk = Get-TestDisk $removeImage
    if (!(Get-Partition -DiskNumber $disk.Number | Where-Object DriveLetter -eq $removal[0])) { throw 'Refusing to dismount a volume outside the test image' }
    & mountvol.exe $removal /P
    if ($LASTEXITCODE -ne 0) { throw 'Disposable test volume could not be dismounted' }
    Remove-TestImage $removeImage
    if (!$child.WaitForExit(10000) -or $child.ExitCode -ne 0) { throw "Removal probe failed: $(Get-Content $errorFile -Raw)" }
    $checks.ntfs_removed = (Get-Content $outputFile -Raw).Trim()
  } finally {
    if (!$child.HasExited) { Stop-Process -Id $child.Id -Force }
  }

  Mount-DiskImage -ImagePath $removeImage | Out-Null
  $disk = Get-TestDisk $removeImage
  $partition = Get-Partition -DiskNumber $disk.Number | Where-Object Type -ne 'Reserved' | Select-Object -First 1
  if (!$partition.DriveLetter) {
    Add-PartitionAccessPath -DiskNumber $disk.Number -PartitionNumber $partition.PartitionNumber -AssignDriveLetter
    $partition = Get-Partition -DiskNumber $disk.Number -PartitionNumber $partition.PartitionNumber
  }
  $volume = $partition | Get-Volume
  if ($volume.FileSystemLabel -ne 'HMPREMOVE') { throw 'Unexpected remounted volume' }
  $folder = Join-Path ($partition.DriveLetter + ':\') 'hmp-qualification'
  if (Test-Path (Join-Path $folder 'volume-probe.mov')) { throw 'Removal published a final media file' }
  $partials = @(Get-ChildItem -LiteralPath $folder -Force -Recurse -Filter '*.part')
  if (!$partials.Count) { throw 'No identifiable partial after dismount' }
  $checks.remounted_partial_bytes = $partials[0].Length
} finally {
  $checks | ConvertTo-Json | Set-Content (Join-Path $Evidence 'storage.json') -Encoding utf8
  foreach ($image in @($fullImage, $removeImage, $exfatImage)) { Remove-TestImage $image }
  Remove-Item -LiteralPath $root -Recurse -Force
}
