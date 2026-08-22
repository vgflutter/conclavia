[CmdletBinding()]
param(
    [ValidateRange(15, 720)]
    [int]$MaxRuntimeMinutes = 120
)

$ErrorActionPreference = "Stop"

$taskName = "Conclavia-Unreal-AutoStop"
$currentBootTaskName = "Conclavia-Unreal-AutoStop-CurrentBoot"
$savedDirectory = "C:\ConclaviaStudio\Saved"
$statusPath = Join-Path $savedDirectory "auto-stop.json"
$shutdownMessage = "Conclavia: limite massimo della sessione GPU raggiunto. Arresto tra 60 secondi."
$shutdownArguments = "/s /f /t 60 /d p:0:0 /c `"$shutdownMessage`""

New-Item -ItemType Directory -Path $savedDirectory -Force | Out-Null

$action = New-ScheduledTaskAction `
    -Execute "$env:SystemRoot\System32\shutdown.exe" `
    -Argument $shutdownArguments
$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable

# This trigger is the fail-safe: it is already registered before the next EC2
# boot and therefore survives a closed Mac, browser, frontend, or SSM session.
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$startupTrigger.Delay = "PT${MaxRuntimeMinutes}M"
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $startupTrigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Stops the Conclavia Unreal GPU after the maximum runtime." `
    -Force | Out-Null

# The machine is already running when this installer is invoked. Registering a
# one-shot trigger protects this boot as well, and running the installer again
# intentionally resets the deadline for a new supervised test session.
$deadline = (Get-Date).AddMinutes($MaxRuntimeMinutes)
$currentBootTrigger = New-ScheduledTaskTrigger -Once -At $deadline
Register-ScheduledTask `
    -TaskName $currentBootTaskName `
    -Action $action `
    -Trigger $currentBootTrigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Stops the current Conclavia Unreal GPU session at its deadline." `
    -Force | Out-Null

$status = [ordered]@{
    enabled = $true
    maxRuntimeMinutes = $MaxRuntimeMinutes
    installedAt = (Get-Date).ToUniversalTime().ToString("o")
    deadline = $deadline.ToUniversalTime().ToString("o")
    startupTask = $taskName
    currentBootTask = $currentBootTaskName
}
$status | ConvertTo-Json | Set-Content -Path $statusPath -Encoding UTF8
$status | ConvertTo-Json -Compress
