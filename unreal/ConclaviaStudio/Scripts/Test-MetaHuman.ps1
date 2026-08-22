param(
    [string]$EngineRoot = "C:\Epic\UE_5.8",
    [string]$ProjectPath = "C:\ConclaviaStudio\ConclaviaStudio.uproject"
)

$ErrorActionPreference = "Stop"

$editor = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$reportPath = Join-Path (Split-Path $ProjectPath) "Saved\Automation\MetaHuman"
$logPath = Join-Path (Split-Path $ProjectPath) "Saved\Logs\ConclaviaStudio.log"

New-Item -ItemType Directory -Force -Path $reportPath | Out-Null

& $editor `
    $ProjectPath `
    -unattended `
    -RenderOffscreen `
    -NoSplash `
    -AudioMixer `
    '-ExecCmds=Automation RunTests MetaHuman.Creator.Character' `
    '-TestExit=Automation Test Queue Empty' `
    "-ReportExportPath=$reportPath" `
    -log

$exitCode = $LASTEXITCODE
Write-Output "EXIT=$exitCode"

$report = Join-Path $reportPath "index.json"
if (Test-Path $report) {
    Get-Content $report -Raw
}

Write-Output "=== LOG TAIL ==="
if (Test-Path $logPath) {
    Get-Content $logPath -Tail 160
}

if ($exitCode -ne 0) {
    throw "MetaHuman automation failed with Unreal exit code $exitCode."
}
