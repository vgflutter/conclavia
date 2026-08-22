param(
    [string]$EngineRoot = "C:\Epic\UE_5.8",
    [string]$ProjectPath = "C:\ConclaviaStudio\ConclaviaStudio.uproject",
    [string]$InfrastructureRoot = "C:\PixelStreamingInfrastructure",
    [int]$PlayerPort = 8080,
    [int]$StreamerPort = 8888,
    [int]$GraphicsAdapter = 0,
    [ValidateSet("wide", "close-up", "two-shot", "profile")]
    [string]$Shot = "close-up",
    [string]$SpeakerId = "participant-3",
    [string]$TargetId = "",
    [int]$StartupTimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"

$editor = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor.exe"
$serverScript = Join-Path $InfrastructureRoot "SignallingWebServer\platform_scripts\cmd\start.bat"
$node = "C:\Program Files\nodejs\node.exe"
$projectRoot = Split-Path $ProjectPath
$viewerScript = Join-Path $projectRoot "Scripts\Verify-PixelStreamingViewer.cjs"
$stageScript = (Join-Path $projectRoot "Scripts\stage_metahuman_cast.py").Replace("\", "/")
$artifacts = Join-Path $projectRoot "Saved\PixelStreaming"
$serverOutput = Join-Path $artifacts "metahuman-signalling.stdout.log"
$serverError = Join-Path $artifacts "metahuman-signalling.stderr.log"
$viewerOutput = Join-Path $artifacts "metahuman-viewer.stdout.log"
$viewerError = Join-Path $artifacts "metahuman-viewer.stderr.log"
$viewerScreenshot = Join-Path $artifacts "metahuman-preview.jpg"

foreach ($requiredPath in @($editor, $serverScript, $node, $viewerScript, $stageScript, $ProjectPath)) {
    if (-not (Test-Path $requiredPath)) {
        throw "Required MetaHuman preview path not found: $requiredPath"
    }
}

New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
Remove-Item $serverOutput, $serverError, $viewerOutput, $viewerError, $viewerScreenshot `
    -Force `
    -ErrorAction SilentlyContinue

$serverCommand = "`"$serverScript`" -- --player_port $PlayerPort --streamer_port $StreamerPort"
$server = Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList @("/c", $serverCommand) `
    -WorkingDirectory (Split-Path $serverScript) `
    -RedirectStandardOutput $serverOutput `
    -RedirectStandardError $serverError `
    -PassThru

$unreal = $null
$viewer = $null

try {
    $playerUri = "http://127.0.0.1:$PlayerPort/?AutoConnect=true&AutoPlayVideo=true"
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    $playerResponse = $null
    while ((Get-Date) -lt $deadline) {
        if ($server.HasExited) {
            throw "Pixel Streaming signalling server exited before becoming ready."
        }
        try {
            $playerResponse = Invoke-WebRequest -UseBasicParsing -Uri $playerUri -TimeoutSec 3
            if ($playerResponse.StatusCode -eq 200) { break }
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }
    if ($null -eq $playerResponse) {
        throw "Pixel Streaming player did not become ready."
    }

    $speakerSeat = [int]($SpeakerId -replace "[^0-9]", "")
    if ($speakerSeat -lt 1 -or $speakerSeat -gt 5) {
        throw "SpeakerId must end with a seat number from 1 to 5."
    }
    $env:CONCLAVIA_PREVIEW_CAMERA = switch ($Shot) {
        "wide" { "CAM_Wide_Master" }
        "close-up" { "CAM_Seat_${speakerSeat}_Close" }
        "two-shot" {
            if ($speakerSeat -le 3) { "CAM_TwoShot_Left" } else { "CAM_TwoShot_Right" }
        }
        "profile" {
            if ($speakerSeat -le 3) { "CAM_Wide_Slider_Left" } else { "CAM_Wide_Slider_Right" }
        }
    }
    # Preview MetaHumans use a separate Chaos garment. Keep body and garment
    # coherent for the quality gate; seated motion is validated on assembled
    # production characters instead.
    $env:CONCLAVIA_PREVIEW_SEATED = "0"

    $execCommands = "py $stageScript"
    $unrealArguments = @(
        $ProjectPath,
        "-unattended",
        "-RenderOffscreen",
        "-NoSplash",
        "-ForceRes",
        "-ResX=1280",
        "-ResY=720",
        "-graphicsadapter=$GraphicsAdapter",
        "-PixelStreamingURL=ws://127.0.0.1:$StreamerPort",
        "-PixelStreamingEncoderCodec=H264",
        "-PixelStreamingWebRTCNegotiateCodecs=true",
        "-PixelStreamingWebRTCStartBitrate=10000000",
        "-PixelStreamingWebRTCMaxBitrate=20000000",
        "`"-ExecCmds=$execCommands`"",
        "-log"
    )
    $unreal = Start-Process -FilePath $editor -ArgumentList $unrealArguments -PassThru

    $streamDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    $streamerConnected = $false
    while ((Get-Date) -lt $streamDeadline) {
        if ($unreal.HasExited) {
            throw "Unreal Editor exited before the MetaHuman stream connected (exit code $($unreal.ExitCode))."
        }
        $connections = Get-NetTCPConnection -LocalPort $StreamerPort -State Established -ErrorAction SilentlyContinue
        if (@($connections).Count -gt 0) {
            $streamerConnected = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $streamerConnected) {
        throw "MetaHuman editor stream did not connect to the signalling server."
    }

    $viewer = Start-Process `
        -FilePath $node `
        -ArgumentList @($viewerScript, $playerUri, $viewerScreenshot) `
        -RedirectStandardOutput $viewerOutput `
        -RedirectStandardError $viewerError `
        -PassThru

    $viewerDeadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $viewerDeadline -and -not (Test-Path $viewerScreenshot)) {
        if ($viewer.HasExited) {
            $details = if (Test-Path $viewerError) { Get-Content $viewerError -Raw } else { "" }
            throw "Viewer exited before receiving the MetaHuman frame. $details"
        }
        Start-Sleep -Seconds 2
    }
    if (-not (Test-Path $viewerScreenshot)) {
        throw "Viewer connected but did not capture the MetaHuman frame."
    }

    $viewer.WaitForExit(30000) | Out-Null
    $viewerResult = Get-Content $viewerOutput -Raw | ConvertFrom-Json
    $unrealLog = Get-ChildItem (Join-Path $projectRoot "Saved\Logs") -Filter "*.log" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    $castReady = Select-String -Path $unrealLog.FullName -Pattern "CONCLAVIA_METAHUMAN_STAGE: READY cast=5" -Quiet
    $editorStreamReady = Select-String -Path $unrealLog.FullName -Pattern "CONCLAVIA_EDITOR_STREAM_STARTED" -Quiet
    $gpuSummary = & nvidia-smi `
        --query-gpu=name,driver_version,memory.used,utilization.gpu,utilization.encoder `
        --format=csv,noheader

    [ordered]@{
        playerStatus = $playerResponse.StatusCode
        streamerConnected = $streamerConnected
        castReady = $castReady
        editorStreamReady = $editorStreamReady
        shot = $Shot
        camera = $env:CONCLAVIA_PREVIEW_CAMERA
        viewer = $viewerResult
        gpu = $gpuSummary
    } | ConvertTo-Json -Depth 8
}
finally {
    Remove-Item Env:CONCLAVIA_PREVIEW_CAMERA -ErrorAction SilentlyContinue
    Remove-Item Env:CONCLAVIA_PREVIEW_SEATED -ErrorAction SilentlyContinue
    foreach ($process in @($viewer, $unreal, $server)) {
        if ($null -ne $process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        }
    }
}
