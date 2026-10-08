param(
  [ValidateRange(10, 120)]
  [int]$Seconds = 30
)

$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Seconds $Seconds"
  $elevated = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $elevated.ExitCode
}

$minecraft = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @('java.exe', 'javaw.exe') -and
  $_.CommandLine -match 'net\.minecraft\.client\.main\.Main'
})
if ($minecraft.Count -ne 1) {
  throw "Expected exactly one running Minecraft client, found $($minecraft.Count)."
}

$status = (& wpr.exe -status 2>&1) -join "`n"
if ($status -notmatch 'WPR is not recording') {
  throw 'Another Windows Performance Recorder session is active. Stop it before starting this capture.'
}

$project = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$sessionDirectory = Join-Path $project "diagnostics\windows-stutter-$stamp"
New-Item -ItemType Directory -Path $sessionDirectory -Force | Out-Null
$trace = Join-Path $sessionDirectory 'windows-gpu.etl'
$metadata = Join-Path $sessionDirectory 'session.txt'

@(
  "Captured: $(Get-Date -Format o)"
  "DurationSeconds: $Seconds"
  "MinecraftProcessId: $($minecraft[0].ProcessId)"
  "MinecraftExecutable: $($minecraft[0].ExecutablePath)"
) | Set-Content -LiteralPath $metadata -Encoding utf8

$started = $false
try {
  & wpr.exe -start GPU -start CPU -start DiskIO -filemode | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Windows Performance Recorder could not start.' }
  $started = $true
  Write-Host "Recording Windows GPU, CPU, and disk scheduling for $Seconds seconds."
  Write-Host 'Move and turn in the affected world until capture completes.'
  Start-Sleep -Seconds $Seconds
  & wpr.exe -stop $trace | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Windows Performance Recorder could not save the trace.' }
  $started = $false
} finally {
  if ($started) { & wpr.exe -cancel | Out-Null }
}

Write-Host "Capture complete: $sessionDirectory"
Write-Output $sessionDirectory
