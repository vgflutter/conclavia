param(
    [string]$EngineRoot = "C:\Epic\UE_5.8",
    [string]$ProjectPath = "C:\ConclaviaStudio\ConclaviaStudio.uproject",
    [string]$InfrastructureRoot = "C:\PixelStreamingInfrastructure",
    [ValidateSet("pop", "serious")]
    [string]$Profile = "pop",
    [int]$PlayerPort = 8080,
    [int]$StreamerPort = 8888,
    [int]$GraphicsAdapter = 1,
    [ValidateSet("wide", "close-up", "confront")]
    [string]$Shot = "wide",
    [switch]$RebuildInfrastructure,
    [int]$StartupTimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"

$editor = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$serverScript = Join-Path $InfrastructureRoot "SignallingWebServer\platform_scripts\cmd\start.bat"
$node = "C:\Program Files\nodejs\node.exe"
$viewerScript = Join-Path (Split-Path $ProjectPath) "Scripts\Verify-PixelStreamingViewer.cjs"
$artifacts = Join-Path (Split-Path $ProjectPath) "Saved\PixelStreaming"
$serverOutput = Join-Path $artifacts "signalling.stdout.log"
$serverError = Join-Path $artifacts "signalling.stderr.log"
$viewerOutput = Join-Path $artifacts "viewer.stdout.log"
$viewerError = Join-Path $artifacts "viewer.stderr.log"
$viewerScreenshot = Join-Path $artifacts "viewer.jpg"

foreach ($requiredPath in @($editor, $serverScript, $node, $viewerScript, $ProjectPath)) {
    if (-not (Test-Path $requiredPath)) {
        throw "Required Pixel Streaming path not found: $requiredPath"
    }
}

New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
Remove-Item $serverOutput, $serverError, $viewerOutput, $viewerError, $viewerScreenshot `
    -Force `
    -ErrorAction SilentlyContinue

$serverBootstrapArguments = if ($RebuildInfrastructure) { "--rebuild " } else { "" }
$serverCommand = "`"$serverScript`" $serverBootstrapArguments-- --player_port $PlayerPort --streamer_port $StreamerPort"
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
            if ($playerResponse.StatusCode -eq 200) {
                break
            }
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }

    if ($null -eq $playerResponse) {
        throw "Pixel Streaming player did not become ready within $StartupTimeoutSeconds seconds."
    }

    $unrealArguments = @(
        $ProjectPath,
        "-game",
        "-unattended",
        "-RenderOffscreen",
        "-NoSplash",
        "-AudioMixer",
        "-ForceRes",
        "-ResX=1280",
        "-ResY=720",
        "-graphicsadapter=$GraphicsAdapter",
        "-ConclaviaStudioProfile=$Profile",
        "-PixelStreamingURL=ws://127.0.0.1:$StreamerPort",
        "-PixelStreamingEncoderCodec=H264",
        "-PixelStreamingWebRTCStartBitrate=10000000",
        "-PixelStreamingWebRTCMaxBitrate=20000000",
        "-log"
    )

    $unreal = Start-Process -FilePath $editor -ArgumentList $unrealArguments -PassThru

    $streamDeadline = (Get-Date).AddSeconds(180)
    $streamerConnected = $false
    while ((Get-Date) -lt $streamDeadline) {
        if ($unreal.HasExited) {
            throw "Unreal exited before connecting to the signalling server (exit code $($unreal.ExitCode))."
        }

        $connections = Get-NetTCPConnection -LocalPort $StreamerPort -State Established -ErrorAction SilentlyContinue
        if (@($connections).Count -gt 0) {
            $streamerConnected = $true
            break
        }

        Start-Sleep -Seconds 2
    }

    if (-not $streamerConnected) {
        throw "Unreal did not connect to the Pixel Streaming signalling server."
    }

    $cueResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "http://127.0.0.1:8081/director/cue" `
        -ContentType "application/json" `
        -Body (@{
            speakerId = "participant-2"
            targetId = "participant-4"
            speakerName = "Lorenzo Vitale"
            targetName = "Marco Bellini"
            shot = $Shot
            intent = "challenge"
        } | ConvertTo-Json) `
        -TimeoutSec 10

    $viewer = Start-Process `
        -FilePath $node `
        -ArgumentList @($viewerScript, $playerUri, $viewerScreenshot) `
        -RedirectStandardOutput $viewerOutput `
        -RedirectStandardError $viewerError `
        -PassThru

    $viewerDeadline = (Get-Date).AddSeconds(90)
    $viewerFrameReady = $false
    while ((Get-Date) -lt $viewerDeadline) {
        if ($viewer.HasExited) {
            $details = if (Test-Path $viewerError) { Get-Content $viewerError -Raw } else { "" }
            throw "The Pixel Streaming viewer exited before receiving video. $details"
        }

        if (Test-Path $viewerScreenshot) {
            $viewerFrameReady = $true
            break
        }

        Start-Sleep -Seconds 2
    }

    if (-not $viewerFrameReady) {
        throw "The viewer connected, but did not receive a decodable Pixel Streaming frame."
    }

    $gpuSummary = & nvidia-smi `
        --query-gpu=name,driver_version,memory.used,utilization.gpu,utilization.encoder `
        --format=csv,noheader
    $gpuSamples = & nvidia-smi dmon -s u -d 1 -c 6

    $viewer.WaitForExit(30000) | Out-Null
    if (-not $viewer.HasExited) {
        throw "The Pixel Streaming viewer did not finish its verification run."
    }

    $viewerResult = Get-Content $viewerOutput -Raw | ConvertFrom-Json

    $unrealLog = Get-ChildItem (Join-Path (Split-Path $ProjectPath) "Saved\Logs") `
        -Filter "*.log" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    $cudaReady = Select-String -Path $unrealLog.FullName -Pattern "Created CUDA context" -Quiet
    $hardwareEncoderFailed = Select-String -Path $unrealLog.FullName -Pattern "Could not setup hardware encoder" -Quiet

    [ordered]@{
        profile = $Profile
        shot = $Shot
        cueAccepted = $cueResponse.accepted
        playerStatus = $playerResponse.StatusCode
        playerBytes = $playerResponse.RawContentLength
        signallingProcessId = $server.Id
        unrealProcessId = $unreal.Id
        streamerConnected = $streamerConnected
        viewer = $viewerResult
        cudaReady = $cudaReady
        hardwareEncoderFailed = $hardwareEncoderFailed
        gpu = $gpuSummary
        gpuSamples = $gpuSamples
    } | ConvertTo-Json -Depth 8
}
finally {
    foreach ($process in @($viewer, $unreal, $server)) {
        if ($null -ne $process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        }
    }
}
