param(
  [ValidateRange(10, 600)]
  [int]$Seconds = 60,
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = 'Stop'

$minecraft = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @('java.exe', 'javaw.exe') -and
  $_.CommandLine -match 'net\.minecraft\.client\.main\.Main'
})

if ($minecraft.Count -eq 0) {
  throw 'Minecraft is not running. Start the affected profile, enter a world, then run this monitor.'
}
if ($minecraft.Count -gt 1) {
  throw "More than one Minecraft client is running. Close the extra client and retry. PIDs: $($minecraft.ProcessId -join ', ')"
}

$processId = [int]$minecraft[0].ProcessId
$javaDirectory = Split-Path -Parent $minecraft[0].ExecutablePath
$jcmd = Join-Path $javaDirectory 'jcmd.exe'
$jfr = Join-Path $javaDirectory 'jfr.exe'
if (-not (Test-Path -LiteralPath $jcmd)) { throw "jcmd.exe was not found beside the game runtime: $javaDirectory" }
if (-not (Test-Path -LiteralPath $jfr)) { throw "jfr.exe was not found beside the game runtime: $javaDirectory" }

if (-not $OutputDirectory) {
  $project = Split-Path -Parent $PSScriptRoot
  $OutputDirectory = Join-Path $project 'diagnostics'
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$sessionDirectory = Join-Path $OutputDirectory "stutter-$stamp"
New-Item -ItemType Directory -Path $sessionDirectory -Force | Out-Null

$recording = Join-Path $sessionDirectory 'minecraft.jfr'
$stagingDirectory = Join-Path $env:PUBLIC 'BlocklaneDiagnostics'
New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
$stagedRecording = Join-Path $stagingDirectory "minecraft-$stamp.jfr"
$samplesFile = Join-Path $sessionDirectory 'process-samples.csv'
$summaryFile = Join-Path $sessionDirectory 'jfr-summary.txt'
$metadataFile = Join-Path $sessionDirectory 'session.txt'

@(
  "Captured: $(Get-Date -Format o)"
  "DurationSeconds: $Seconds"
  "ProcessId: $processId"
  "Executable: $($minecraft[0].ExecutablePath)"
) | Set-Content -LiteralPath $metadataFile -Encoding utf8

$jfrArguments = @(
  $processId
  'JFR.start'
  'name=BlocklaneStutter'
  'settings=profile'
  "duration=${Seconds}s"
  "filename=$stagedRecording"
)
$startResult = & $jcmd @jfrArguments 2>&1
if ($LASTEXITCODE -ne 0 -or ($startResult -join "`n") -notmatch 'Started recording') {
  throw "Java Flight Recorder could not start:`n$($startResult -join "`n")"
}

Write-Host "Recording Minecraft PID $processId for $Seconds seconds."
Write-Host 'Move and turn in the affected world until capture completes.'

$logicalProcessors = [Math]::Max(1, [Environment]::ProcessorCount)
$samples = [System.Collections.Generic.List[object]]::new()
$previous = Get-Process -Id $processId
$previousCpu = $previous.TotalProcessorTime.TotalSeconds
$previousTime = [DateTime]::UtcNow
$deadline = $previousTime.AddSeconds($Seconds)

while ([DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 250
  $now = [DateTime]::UtcNow
  $game = Get-Process -Id $processId -ErrorAction Stop
  $cpu = $game.TotalProcessorTime.TotalSeconds
  $elapsed = [Math]::Max(0.001, ($now - $previousTime).TotalSeconds)
  $cpuPercent = (($cpu - $previousCpu) / $elapsed / $logicalProcessors) * 100
  $samples.Add([pscustomobject]@{
    Timestamp = $now.ToString('o')
    CpuPercent = [Math]::Round($cpuPercent, 2)
    WorkingSetMB = [Math]::Round($game.WorkingSet64 / 1MB, 1)
    PrivateMemoryMB = [Math]::Round($game.PrivateMemorySize64 / 1MB, 1)
    Threads = $game.Threads.Count
    Handles = $game.HandleCount
    Responding = $game.Responding
  })
  $previousCpu = $cpu
  $previousTime = $now
}

$samples | Export-Csv -LiteralPath $samplesFile -NoTypeInformation -Encoding utf8
for ($attempt = 0; $attempt -lt 20 -and -not (Test-Path -LiteralPath $stagedRecording); $attempt++) {
  Start-Sleep -Milliseconds 250
}
if (-not (Test-Path -LiteralPath $stagedRecording)) { throw 'The Java recording did not finish writing.' }
Move-Item -LiteralPath $stagedRecording -Destination $recording

& $jfr summary $recording 2>&1 | Set-Content -LiteralPath $summaryFile -Encoding utf8
Write-Host "Capture complete: $sessionDirectory"
Write-Output $sessionDirectory
