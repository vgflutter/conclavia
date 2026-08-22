param(
    [string]$EngineRoot = "C:\Epic\UE_5.8",
    [string]$ProjectPath = "C:\ConclaviaStudio\ConclaviaStudio.uproject",
    [string]$InfrastructureRoot = "C:\PixelStreamingInfrastructure",
    [int]$PlayerPort = 8080,
    [int]$StreamerPort = 8888,
    [int]$GraphicsAdapter = 0,
    [int]$StartupTimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"

$editor = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor.exe"
$editorCmd = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$serverScript = Join-Path $InfrastructureRoot "SignallingWebServer\platform_scripts\cmd\start.bat"
$node = "C:\Program Files\nodejs\node.exe"
$projectRoot = Split-Path $ProjectPath
$viewerScript = Join-Path $projectRoot "Scripts\Verify-PixelStreamingViewer.cjs"
$stageScript = (Join-Path $projectRoot "Scripts\stage_production_hero.py").Replace("\", "/")
$artifacts = Join-Path $projectRoot "Saved\ProductionHero"
$stageOutput = Join-Path $artifacts "stage.stdout.log"
$stageError = Join-Path $artifacts "stage.stderr.log"
$serverOutput = Join-Path $artifacts "signalling.stdout.log"
$serverError = Join-Path $artifacts "signalling.stderr.log"
$viewerOutput = Join-Path $artifacts "viewer.stdout.log"
$viewerError = Join-Path $artifacts "viewer.stderr.log"
$screenshot = Join-Path $artifacts "cinematic-hero.jpg"

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
        throw "Required production hero path not found: $requiredPath"
    }
}

New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
Remove-Item `
    $stageOutput,
    $stageError,
    $serverOutput,
    $serverError,
    $viewerOutput,
    $viewerError,
    $screenshot `
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
    throw "Production hero staging failed with exit code $($stage.ExitCode). $details"
}

$latestLog = Get-ChildItem (Join-Path $projectRoot "Saved\Logs") -Filter "*.log" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($null -eq $latestLog -or -not (
    Select-String `
        -Path $latestLog.FullName `
        -Pattern "CONCLAVIA_PRODUCTION_HERO_STAGE: READY" `
        -Quiet
)) {
    throw "Staging exited without the production hero ready marker."
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

    $unreal = Start-Process -FilePath $editor -ArgumentList @(
        $ProjectPath,
        "/Game/Conclavia/Studio/L_PremiumStudio",
        "-game",
        "-unattended",
        "-RenderOffscreen",
        "-NoSplash",
        "-AudioMixer",
        "-ForceRes",
        "-ResX=1920",
        "-ResY=1080",
        "-graphicsadapter=$GraphicsAdapter",
        "-ConclaviaStudioProfile=pop",
        "-PixelStreamingURL=ws://127.0.0.1:$StreamerPort",
        "-PixelStreamingEncoderCodec=H264",
        "-PixelStreamingWebRTCNegotiateCodecs=true",
        "-PixelStreamingWebRTCStartBitrate=18000000",
        "-PixelStreamingWebRTCMaxBitrate=32000000",
        "-log"
    ) -PassThru

    $streamDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    $streamerConnected = $false
    while ((Get-Date) -lt $streamDeadline) {
        if ($unreal.HasExited) {
            throw "Unreal exited before the Cinematic stream connected."
        }
        if (@(Get-NetTCPConnection -LocalPort $StreamerPort -State Established -ErrorAction SilentlyContinue).Count -gt 0) {
            $streamerConnected = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $streamerConnected) {
        throw "Cinematic MetaHuman stream did not connect."
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
        throw "Director did not report a ready hero stage."
    }

    $cue = @{
        speakerId = "participant-3"
        targetId = ""
        speakerName = "Marco Bellini"
        targetName = ""
        shot = "close-up"
        intent = "argument"
        # Keep the requested close-up active through the viewer's 35-second
        # shader/groom warm-up. Production cues use their real speech duration.
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
        -ArgumentList @($viewerScript, $playerUri, $screenshot, "no-overscan") `
        -RedirectStandardOutput $viewerOutput `
        -RedirectStandardError $viewerError `
        -PassThru
    $viewerDeadline = (Get-Date).AddSeconds(150)
    while ((Get-Date) -lt $viewerDeadline -and -not (Test-Path $screenshot)) {
        if ($viewer.HasExited) {
            $details = if (Test-Path $viewerError) { Get-Content $viewerError -Raw } else { "" }
            throw "Viewer exited before receiving the hero frame. $details"
        }
        Start-Sleep -Seconds 2
    }
    if (-not (Test-Path $screenshot)) {
        throw "Viewer connected but did not capture the hero frame."
    }

    $viewer.WaitForExit(30000) | Out-Null
    $viewerResult = Get-Content $viewerOutput -Raw | ConvertFrom-Json
    $gpu = & nvidia-smi `
        --query-gpu=name,driver_version,memory.used,utilization.gpu,utilization.encoder `
        --format=csv,noheader
    [ordered]@{
        playerStatus = $playerResponse.StatusCode
        streamerConnected = $streamerConnected
        stageReady = $health.stageReady
        cameraCount = $health.cameraCount
        viewer = $viewerResult
        screenshot = $screenshot
        gpu = $gpu
    } | ConvertTo-Json -Depth 8
}
finally {
    foreach ($process in @($viewer, $unreal, $server)) {
        if ($null -ne $process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        }
    }
}
