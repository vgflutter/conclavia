param(
    [ValidateSet("pop", "serious")]
    [string]$Profile = "pop",
    [ValidateSet("close-up", "wide", "two-shot")]
    [string]$Shot = "close-up",
    [string]$EngineRoot = "C:\Epic\UE_5.8",
    [string]$ProjectPath = "C:\ConclaviaStudio\ConclaviaStudio.uproject",
    [string]$InfrastructureRoot = "C:\PixelStreamingInfrastructure",
    [int]$PlayerPort = 8080,
    [int]$StreamerPort = 8888,
    [int]$GraphicsAdapter = 1,
    [int]$StartupTimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"

$editor = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor.exe"
$editorCmd = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$serverScript = Join-Path $InfrastructureRoot "SignallingWebServer\platform_scripts\cmd\start.bat"
$node = "C:\Program Files\nodejs\node.exe"
$projectRoot = Split-Path $ProjectPath
$viewerScript = Join-Path $projectRoot "Scripts\Verify-PixelStreamingViewer.cjs"
$stageScript = (Join-Path $projectRoot "Scripts\stage_production_cast.py").Replace("\", "/")
$artifacts = Join-Path $projectRoot "Saved\PixelStreaming"
$serverOutput = Join-Path $artifacts "production-signalling.stdout.log"
$serverError = Join-Path $artifacts "production-signalling.stderr.log"
$viewerOutput = Join-Path $artifacts "production-viewer.stdout.log"
$viewerError = Join-Path $artifacts "production-viewer.stderr.log"
$viewerScreenshot = Join-Path $artifacts "production-$Profile-$Shot.jpg"
$stageOutput = Join-Path $artifacts "production-stage.stdout.log"
$stageError = Join-Path $artifacts "production-stage.stderr.log"

foreach ($requiredPath in @(
    $editor,
    $editorCmd,
    $serverScript,
    $node,
    $viewerScript,
    $stageScript,
    $ProjectPath
)) {
    if (-not (Test-Path $requiredPath)) {
        throw "Required production path not found: $requiredPath"
    }
}

New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
Remove-Item `
    $serverOutput,
    $serverError,
    $viewerOutput,
    $viewerError,
    $viewerScreenshot,
    $stageOutput,
    $stageError `
    -Force `
    -ErrorAction SilentlyContinue

$stage = Start-Process `
    -FilePath $editorCmd `
    -ArgumentList @(
        $ProjectPath,
        "-unattended",
        "-nop4",
        "-nosplash",
        "-nullrhi",
        "-ExecutePythonScript=$stageScript"
    ) `
    -RedirectStandardOutput $stageOutput `
    -RedirectStandardError $stageError `
    -PassThru `
    -Wait
if ($stage.ExitCode -ne 0) {
    $details = if (Test-Path $stageError) { Get-Content $stageError -Raw } else { "" }
    throw "Production cast staging failed with exit code $($stage.ExitCode). $details"
}

$latestLog = Get-ChildItem (Join-Path $projectRoot "Saved\Logs") -Filter "*.log" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not (Select-String -Path $latestLog.FullName -Pattern "CONCLAVIA_PRODUCTION_STAGE: READY maps=2 cast=5" -Quiet)) {
    throw "Production staging process exited without the five-person ready marker."
}

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

    $map = if ($Profile -eq "serious") {
        "/Game/Conclavia/Studio/L_EditorialStudio"
    } else {
        "/Game/Conclavia/Studio/L_PremiumStudio"
    }
    $unrealArguments = @(
        $ProjectPath,
        $map,
        "-game",
        "-unattended",
        "-RenderOffscreen",
        "-NoSplash",
        "-AudioMixer",
        "-ForceRes",
        "-ResX=1920",
        "-ResY=1080",
        "-graphicsadapter=$GraphicsAdapter",
        "-ConclaviaStudioProfile=$Profile",
        "-PixelStreamingURL=ws://127.0.0.1:$StreamerPort",
        "-PixelStreamingEncoderCodec=H264",
        "-PixelStreamingWebRTCNegotiateCodecs=true",
        "-PixelStreamingWebRTCStartBitrate=14000000",
        "-PixelStreamingWebRTCMaxBitrate=28000000",
        "-ExecCmds=sg.ViewDistanceQuality 4,sg.AntiAliasingQuality 4,sg.ShadowQuality 4,sg.GlobalIlluminationQuality 4,sg.ReflectionQuality 4,sg.PostProcessQuality 4,sg.TextureQuality 4,sg.EffectsQuality 4,sg.ShadingQuality 4,r.Streaming.FullyLoadUsedTextures 1",
        "-log"
    )
    $unreal = Start-Process -FilePath $editor -ArgumentList $unrealArguments -PassThru

    $streamDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    $streamerConnected = $false
    while ((Get-Date) -lt $streamDeadline) {
        if ($unreal.HasExited) {
            throw "Unreal exited before the production stream connected (exit code $($unreal.ExitCode))."
        }
        $connections = Get-NetTCPConnection -LocalPort $StreamerPort -State Established -ErrorAction SilentlyContinue
        if (@($connections).Count -gt 0) {
            $streamerConnected = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $streamerConnected) {
        throw "Production stream did not connect to the signalling server."
    }

    $healthDeadline = (Get-Date).AddSeconds(120)
    $health = $null
    while ((Get-Date) -lt $healthDeadline) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:8081/health" -TimeoutSec 5
            if ($health.stageReady) { break }
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }
    if ($null -eq $health -or -not $health.stageReady) {
        throw "Director control plane did not report a ready production stage."
    }

    $cue = @{
        speakerId = "participant-3"
        targetId = "participant-2"
        speakerName = "Giulia Ferri"
        targetName = "Lorenzo Vitale"
        shot = $Shot
        intent = "challenge"
        expectedDurationMs = 60000
    } | ConvertTo-Json
    Invoke-RestMethod `
        -Uri "http://127.0.0.1:8081/director/cue" `
        -Method Post `
        -ContentType "application/json" `
        -Body $cue `
        -TimeoutSec 10 | Out-Null

    $viewer = Start-Process `
        -FilePath $node `
        -ArgumentList @($viewerScript, $playerUri, $viewerScreenshot, "no-overscan") `
        -RedirectStandardOutput $viewerOutput `
        -RedirectStandardError $viewerError `
        -PassThru

    $viewerDeadline = (Get-Date).AddSeconds(150)
    while ((Get-Date) -lt $viewerDeadline -and -not (Test-Path $viewerScreenshot)) {
        if ($viewer.HasExited) {
            $details = if (Test-Path $viewerError) { Get-Content $viewerError -Raw } else { "" }
            throw "Viewer exited before receiving the production frame. $details"
        }
        Start-Sleep -Seconds 2
    }
    if (-not (Test-Path $viewerScreenshot)) {
        throw "Viewer connected but did not capture the production frame."
    }

    $viewer.WaitForExit(30000) | Out-Null
    $viewerResult = Get-Content $viewerOutput -Raw | ConvertFrom-Json
    $gpuSummary = & nvidia-smi `
        --query-gpu=name,driver_version,memory.used,utilization.gpu,utilization.encoder `
        --format=csv,noheader

    [ordered]@{
        profile = $Profile
        shot = $Shot
        playerStatus = $playerResponse.StatusCode
        streamerConnected = $streamerConnected
        stageReady = $health.stageReady
        cameraCount = $health.cameraCount
        viewer = $viewerResult
        screenshot = $viewerScreenshot
        gpu = $gpuSummary
    } | ConvertTo-Json -Depth 8
}
finally {
    foreach ($process in @($viewer, $unreal, $server)) {
        if ($null -ne $process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        }
    }
}
