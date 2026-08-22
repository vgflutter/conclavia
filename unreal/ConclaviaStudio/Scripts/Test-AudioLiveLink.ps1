param(
    [string]$EngineRoot = "C:\Epic\UE_5.8",
    [string]$ProjectPath = "C:\ConclaviaStudio\ConclaviaStudio.uproject"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $ProjectPath
$auditScript = (Join-Path $projectRoot "Scripts\audit_metahuman_audio.py").Replace("\", "/")
$feedSource = Join-Path $projectRoot "Scripts\Test-PcmBridgeClient.cs"
$feedBinary = Join-Path $projectRoot "Binaries\PcmBridge\Test-PcmBridgeClient.exe"
$tokenFile = Join-Path $projectRoot "Saved\supervisor.token"
$compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$editor = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$feeder = $null

try {
    & (Join-Path $projectRoot "Scripts\Start-PcmBridge.ps1") | Out-Null
    & $compiler /nologo /optimize+ /target:exe "/out:$feedBinary" $feedSource
    if ($LASTEXITCODE -ne 0) { throw "PCM test client compilation failed." }
    $feeder = Start-Process `
        -FilePath $feedBinary `
        -ArgumentList @($tokenFile) `
        -PassThru

    & $editor `
        $ProjectPath `
        -unattended `
        -nop4 `
        -nosplash `
        -RenderOffscreen `
        -d3d12 `
        -graphicsadapter=1 `
        -AudioMixer `
        "-ExecutePythonScript=$auditScript"
    if ($LASTEXITCODE -ne 0) {
        throw "MetaHuman Audio Live Link audit exited with code $LASTEXITCODE."
    }

    $latestLog = Get-ChildItem (Join-Path $projectRoot "Saved\Logs") -Filter "*.log" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    $subjectReady = Select-String `
        -Path $latestLog.FullName `
        -Pattern "CONCLAVIA_AUDIO_LIVE_LINK: subject=.*succeeded=True" `
        -Quiet
    if (-not $subjectReady) {
        throw "Audio source was visible but the MetaHuman Live Link subject did not receive samples."
    }
    "CONCLAVIA_AUDIO_BRIDGE: READY source=VB-Audio-CABLE format=48000Hz"
}
finally {
    if ($null -ne $feeder -and -not $feeder.HasExited) {
        Stop-Process -Id $feeder.Id -Force -ErrorAction SilentlyContinue
    }
}
