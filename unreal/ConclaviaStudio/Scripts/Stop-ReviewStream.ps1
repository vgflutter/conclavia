param(
    [string]$PidFile = "C:\ConclaviaStudio\Saved\PixelStreaming\review-processes.json",
    [string]$ReadyFile = "C:\ConclaviaStudio\Saved\PixelStreaming\review-ready.json"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $PidFile)) {
    @{ ok = $true; running = $false } | ConvertTo-Json -Compress
    exit 0
}

$state = Get-Content $PidFile -Raw | ConvertFrom-Json
foreach ($processId in @($state.unreal, $state.server)) {
    if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        ($_.Name -in @("UnrealEditor.exe", "ConclaviaStudio.exe", "RMHLipSyncDemo.exe") -and
            ($_.CommandLine -like "*ConclaviaStudio.uproject*" -or
                $_.CommandLine -like "*RMHLipSyncDemo.uproject*")) -or
        ($_.Name -eq "node.exe" -and $_.CommandLine -like "*SignallingWebServer*") -or
        ($_.Name -eq "turnserver.exe" -and $_.CommandLine -like "*PixelStreaming*") -or
        ($_.Name -eq "cmd.exe" -and $_.CommandLine -like "*start_with_turn.bat*")
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
Remove-Item $ReadyFile -Force -ErrorAction SilentlyContinue
@{ ok = $true; running = $false } | ConvertTo-Json -Compress
