param(
    [int]$Port = 8090,
    [string]$TokenFile = "C:\ConclaviaStudio\Saved\supervisor.token"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
$pidFile = "C:\ConclaviaStudio\Saved\PixelStreaming\review-processes.json"
$readyFile = "C:\ConclaviaStudio\Saved\PixelStreaming\review-ready.json"
$startScript = "C:\ConclaviaStudio\Scripts\Start-ReviewStream.ps1"
$stopScript = "C:\ConclaviaStudio\Scripts\Stop-ReviewStream.ps1"
$pcmBridgeScript = "C:\ConclaviaStudio\Scripts\Start-PcmBridge.ps1"
$pcmBridgePort = 8091

if (-not (Test-Path $TokenFile)) {
    throw "Studio supervisor token file is missing: $TokenFile"
}
$token = (Get-Content $TokenFile -Raw).Trim()
if (-not $token) {
    throw "Studio supervisor token is empty."
}

# The official MetaHuman Audio source captures from VB-Cable. Keep its render
# endpoint alive for the lifetime of the supervisor; incoming PCM is written to
# CABLE Input and captured by Unreal as CABLE Output.
try { & $pcmBridgeScript -Port $pcmBridgePort -TokenFile $TokenFile | Out-Null } catch {
    Write-Warning "PCM device bridge did not start: $($_.Exception.Message)"
}

function Test-Running {
    return [bool](Get-UnrealProcess)
}

function Get-StudioStartProcess {
    return Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -eq "powershell.exe" -and
            $_.CommandLine -like "*Start-ReviewStream.ps1*"
        } |
        Select-Object -First 1
}

function Test-Starting {
    return [bool](Get-StudioStartProcess)
}

function Get-UnrealProcess {
    return Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -in @("UnrealEditor.exe", "ConclaviaStudio.exe") -and
            ($_.CommandLine -like "*ConclaviaStudio.uproject*" -or
                $_.CommandLine -like "*RMHLipSyncDemo.uproject*")
        } |
        Select-Object -First 1
}

function Get-RunningProfile {
    $process = Get-UnrealProcess
    if (-not $process) { return $null }
    if ($process.CommandLine -match "-ConclaviaStudioProfile=(lipsync58|lipsync|serious|pop)") {
        return $Matches[1]
    }
    return $null
}

function Get-RunningAvatar {
    $process = Get-UnrealProcess
    if (-not $process) { return $null }
    if ($process.CommandLine -match "-ConclaviaAvatar=(aera|ada|vivian|jelena)") {
        return $Matches[1]
    }
    return "aera"
}

function Stop-StudioProcesses {
    $starter = Get-StudioStartProcess
    if ($starter) {
        Stop-Process -Id $starter.ProcessId -Force -ErrorAction SilentlyContinue
    }
    try { & $stopScript | Out-Null } catch {}
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            ($_.Name -in @("UnrealEditor.exe", "ConclaviaStudio.exe") -and
                ($_.CommandLine -like "*ConclaviaStudio.uproject*" -or
                    $_.CommandLine -like "*RMHLipSyncDemo.uproject*")) -or
            ($_.Name -eq "node.exe" -and $_.CommandLine -like "*SignallingWebServer*") -or
            ($_.Name -eq "turnserver.exe" -and $_.CommandLine -like "*PixelStreaming*") -or
            ($_.Name -eq "cmd.exe" -and $_.CommandLine -like "*start_with_turn.bat*")
        } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Remove-Item $readyFile -Force -ErrorAction SilentlyContinue
}

function Get-State {
    $running = Test-Running
    $verified = $false
    if ($running -and (Test-Path $readyFile)) {
        try {
            $readyState = Get-Content $readyFile -Raw | ConvertFrom-Json
            $process = Get-UnrealProcess
            $verified = $readyState.ready -eq $true -and
                $process -and
                [int]$readyState.unreal -eq [int]$process.ProcessId
        }
        catch {
            $verified = $false
        }
    }
    $profile = Get-RunningProfile
    $avatarId = Get-RunningAvatar
    if (Test-Path $pidFile) {
        if (-not $profile) {
            try { $profile = (Get-Content $pidFile -Raw | ConvertFrom-Json).profile } catch {}
        }
        if (-not $avatarId) {
            try { $avatarId = (Get-Content $pidFile -Raw | ConvertFrom-Json).avatarId } catch {}
        }
    }
    $payload = [ordered]@{
        ok = $false
        service = "conclavia-studio-supervisor"
        running = $running
        starting = (Test-Starting)
        verified = $verified
        profile = $profile
        avatarId = $avatarId
    }
    if ($running) {
        try {
            $studio = Invoke-RestMethod -Uri "http://127.0.0.1:8081/health" -TimeoutSec 4
            $payload.ok = [bool]$studio.ok -and $verified
            $payload.stageReady = [bool]$studio.stageReady
            $payload.runtimeRevision = $studio.runtimeRevision
            $payload.engineVersion = $studio.engineVersion
            $payload.grade1SetReady = [bool]$studio.grade1SetReady
            $payload.grade1PropCount = [int]$studio.grade1PropCount
            $payload.cameraCount = [int]$studio.cameraCount
            $payload.cameraPackage = $studio.cameraPackage
            $payload.castCount = [int]$studio.castCount
            $payload.activeCamera = $studio.activeCamera
            $payload.lastCueAt = $studio.lastCueAt
            $payload.audioSubjectReady = [bool]$studio.audioSubjectReady
            $payload.audioSubjectValid = [bool]$studio.audioSubjectValid
            $payload.faceDrivenByLiveLink = [bool]$studio.faceDrivenByLiveLink
            $payload.commercialLipSyncReady = [bool]$studio.commercialLipSyncReady
            $payload.commercialModelReady = [bool]$studio.commercialModelReady
            $payload.commercialModelRouteReady = [bool]$studio.commercialModelRouteReady
            $payload.commercialGeneratorBound = [bool]$studio.commercialGeneratorBound
            $payload.commercialGeneratorCount = [int]$studio.commercialGeneratorCount
            $payload.commercialControlsBound = [bool]$studio.commercialControlsBound
            $payload.commercialSpeechActive = [bool]$studio.commercialSpeechActive
            $payload.commercialMood = $studio.commercialMood
            $payload.commercialMoodIntensity = [double]$studio.commercialMoodIntensity
            $payload.commercialModel = $studio.commercialModel
            $payload.commercialLookaheadMs = [int]$studio.commercialLookaheadMs
            $payload.commercialControlCount = [int]$studio.commercialControlCount
            $payload.commercialMaxControl = [double]$studio.commercialMaxControl
            $payload.commercialMaxMouthControl = [double]$studio.commercialMaxMouthControl
            $payload.commercialMaxMouthControlName = $studio.commercialMaxMouthControlName
            $payload.commercialMaxUpperFaceControl = [double]$studio.commercialMaxUpperFaceControl
            $payload.commercialMaxUpperFaceControlName = $studio.commercialMaxUpperFaceControlName
            $payload.commercialSpeechPeakMouthControl = [double]$studio.commercialSpeechPeakMouthControl
            $payload.commercialSpeechPeakMouthControlName = $studio.commercialSpeechPeakMouthControlName
            $payload.commercialSpeechPeakUpperFaceControl = [double]$studio.commercialSpeechPeakUpperFaceControl
            $payload.commercialSpeechPeakUpperFaceControlName = $studio.commercialSpeechPeakUpperFaceControlName
            $payload.commercialLastSpeechPeakMouthControl = [double]$studio.commercialLastSpeechPeakMouthControl
            $payload.commercialLastSpeechPeakMouthControlName = $studio.commercialLastSpeechPeakMouthControlName
            $payload.commercialLastSpeechPeakUpperFaceControl = [double]$studio.commercialLastSpeechPeakUpperFaceControl
            $payload.commercialLastSpeechPeakUpperFaceControlName = $studio.commercialLastSpeechPeakUpperFaceControlName
            $payload.commercialLastSpeechSolverChunks = [int]$studio.commercialLastSpeechSolverChunks
            $payload.commercialLastSpeechSolverCursor = [int]$studio.commercialLastSpeechSolverCursor
            $payload.commercialCompletedSpeechCount = [int]$studio.commercialCompletedSpeechCount
            $payload.cameraCueCount = [int]$studio.cameraCueCount
            $payload.speakerHandoffCount = [int]$studio.speakerHandoffCount
            $payload.commercialJawInput = [double]$studio.commercialJawInput
            $payload.commercialJawCurve = [double]$studio.commercialJawCurve
            $payload.commercialBoundNodeCount = [int]$studio.commercialBoundNodeCount
            $payload.commercialSolverChunksSubmitted = [int]$studio.commercialSolverChunksSubmitted
            $payload.commercialSolverCursor = [int]$studio.commercialSolverCursor
            $payload.bodyAnimationMode = [int]$studio.bodyAnimationMode
            $payload.bodyAnimClass = $studio.bodyAnimClass
            $payload.bodyAnimInstance = $studio.bodyAnimInstance
            $payload.pcmBytesReceived = [long]$studio.pcmBytesReceived
            $payload.activeFaceIndex = [int]$studio.activeFaceIndex
            $payload.performancePlanReady = [bool]$studio.performancePlanReady
            $payload.performanceBeatCount = [int]$studio.performanceBeatCount
            $payload.performanceSolverBeatIndex = [int]$studio.performanceSolverBeatIndex
            $payload.performanceAudibleBeatIndex = [int]$studio.performanceAudibleBeatIndex
            $payload.performanceMood = $studio.performanceMood
            $payload.performanceTargetIntensity = [double]$studio.performanceTargetIntensity
            $payload.performanceFocus = $studio.performanceFocus
            $payload.performanceGesture = $studio.performanceGesture
            $payload.performanceAppliedBeatCount = [int]$studio.performanceAppliedBeatCount
            $payload.avatarId = $studio.avatarId
            $payload.bodyGesture = $studio.bodyGesture
            $payload.bodyGestureAlpha = [double]$studio.bodyGestureAlpha
            $payload.bodyGesturePhase = $studio.bodyGesturePhase
            $payload.physicalGestureReady = [bool]$studio.physicalGestureReady
            $payload.physicalGestureDriver = $studio.physicalGestureDriver
            $payload.bodyIdleDriver = $studio.bodyIdleDriver
            $payload.bodyIdlePlayRate = [double]$studio.bodyIdlePlayRate
            $payload.listeningReactionActive = [bool]$studio.listeningReactionActive
            $payload.listeningReactionRemainingMs = [int]$studio.listeningReactionRemainingMs
            $payload.listeningMotionSource = $studio.listeningMotionSource
            $payload.listeningModelReady = [bool]$studio.listeningModelReady
            $payload.listeningSolverChunks = [int]$studio.listeningSolverChunks
            $payload.naturalGazeEnabled = [bool]$studio.naturalGazeEnabled
            $payload.naturalGazeDriver = $studio.naturalGazeDriver
            if ($studio.profile) { $payload.profile = $studio.profile }
        }
        catch {}
    }
    return $payload
}

function Send-Json($context, [int]$status, $payload) {
    try {
        $json = $payload | ConvertTo-Json -Depth 8 -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        $context.Response.StatusCode = $status
        $context.Response.ContentType = "application/json; charset=utf-8"
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.OutputStream.Close()
    }
    catch {
        # A browser or Next request can disappear while a cold GPU is starting.
        # Losing one HTTP response must never terminate the long-lived
        # supervisor and strand a healthy Unreal renderer without control.
        try { $context.Response.Abort() } catch {}
    }
}

$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add("http://+:$Port/")
$listener.Start()
Write-Output "Conclavia Studio supervisor listening on port $Port"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $authorization = $context.Request.Headers["Authorization"]
            if ($authorization -ne "Bearer $token") {
                Send-Json $context 401 @{ ok = $false; error = "unauthorized" }
                continue
            }

            $path = $context.Request.Url.AbsolutePath.TrimEnd("/")
            if (-not $path) { $path = "/" }
            $method = $context.Request.HttpMethod.ToUpperInvariant()

            if ($method -eq "GET" -and $path -eq "/health") {
                Send-Json $context 200 (Get-State)
                continue
            }

            if ($method -eq "POST" -and $path -eq "/start") {
                $reader = [IO.StreamReader]::new($context.Request.InputStream, $context.Request.ContentEncoding)
                $raw = $reader.ReadToEnd()
                $reader.Dispose()
                $body = if ($raw) { $raw | ConvertFrom-Json } else { @{} }
                $profile = if ($body.profile -eq "serious") {
                    "serious"
                } elseif ($body.profile -eq "lipsync58") {
                    "lipsync58"
                } elseif ($body.profile -eq "lipsync") {
                    "lipsync"
                } else {
                    "pop"
                }
                $avatarId = if ($body.avatarId -in @("aera", "ada", "vivian", "jelena")) {
                    $body.avatarId
                } else {
                    "aera"
                }
                $state = Get-State
                if ($state.running -and
                    $state.profile -eq $profile -and
                    $state.avatarId -ne $avatarId) {
                    try {
                        Invoke-RestMethod `
                            -Method Post `
                            -Uri "http://127.0.0.1:8081/avatar" `
                            -ContentType "application/json" `
                            -Body (@{ avatarId = $avatarId } | ConvertTo-Json -Compress) `
                            -TimeoutSec 8 | Out-Null
                        $state = Get-State
                    }
                    catch {
                        # Older bridge builds do not expose runtime switching.
                        # Preserve a safe fallback while deployments roll.
                        Stop-StudioProcesses
                        $state = Get-State
                    }
                }
                elseif ($state.running -and $state.profile -ne $profile) {
                    Stop-StudioProcesses
                    $state = Get-State
                }
                if (-not $state.running) {
                    if (-not (Test-Starting)) {
                        $artifacts = "C:\ConclaviaStudio\Saved\PixelStreaming"
                        New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
                        Start-Process `
                            -FilePath "powershell.exe" `
                            -ArgumentList @(
                                "-NoProfile",
                                "-ExecutionPolicy", "Bypass",
                                "-File", $startScript,
                                "-Profile", $profile,
                                "-AvatarId", $avatarId
                            ) `
                            -WindowStyle Hidden `
                            -RedirectStandardOutput (Join-Path $artifacts "review-bootstrap.stdout.log") `
                            -RedirectStandardError (Join-Path $artifacts "review-bootstrap.stderr.log") `
                            | Out-Null
                    }
                }
                Send-Json $context 200 (Get-State)
                continue
            }

            if ($method -eq "POST" -and $path -eq "/director/cue") {
                $reader = [IO.StreamReader]::new($context.Request.InputStream, $context.Request.ContentEncoding)
                $raw = $reader.ReadToEnd()
                $reader.Dispose()
                $cue = Invoke-RestMethod `
                    -Method Post `
                    -Uri "http://127.0.0.1:8081/director/cue" `
                    -ContentType "application/json" `
                    -Body $raw `
                    -TimeoutSec 8
                Send-Json $context 200 $cue
                continue
            }

            if ($method -eq "POST" -and $path -eq "/audio/pcm") {
                $pcm = New-Object IO.MemoryStream
                $context.Request.InputStream.CopyTo($pcm)
                $bytes = $pcm.ToArray()
                $pcm.Dispose()
                # Windows PowerShell's Invoke-WebRequest transforms byte[]
                # request bodies in some hosts. HttpClient preserves the PCM
                # bytes exactly; a single changed byte count invalidates float32.
                $client = [Net.Http.HttpClient]::new()
                $client.Timeout = [TimeSpan]::FromSeconds(8)
                $content = [Net.Http.ByteArrayContent]::new($bytes)
                $content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new("application/octet-stream")
                $audio = $client.PostAsync(
                    "http://127.0.0.1:$pcmBridgePort/pcm?token=$token",
                    $content).GetAwaiter().GetResult()
                $audioBody = $audio.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                $content.Dispose()
                $client.Dispose()
                if (-not $audio.IsSuccessStatusCode) {
                    throw "PCM bridge returned HTTP $([int]$audio.StatusCode): $audioBody"
                }
                Send-Json $context 200 ($audioBody | ConvertFrom-Json)
                continue
            }

            if ($method -eq "POST" -and $path -eq "/audio/speech") {
                $pcm = New-Object IO.MemoryStream
                $context.Request.InputStream.CopyTo($pcm)
                $bytes = $pcm.ToArray()
                $pcm.Dispose()
                $client = [Net.Http.HttpClient]::new()
                $client.Timeout = [TimeSpan]::FromSeconds(25)
                $content = [Net.Http.ByteArrayContent]::new($bytes)
                $content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new("application/octet-stream")
                $audio = $client.PostAsync(
                    "http://127.0.0.1:8081/audio/speech",
                    $content).GetAwaiter().GetResult()
                $audioBody = $audio.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                $status = [int]$audio.StatusCode
                $content.Dispose()
                $client.Dispose()
                if (-not $audio.IsSuccessStatusCode) {
                    Send-Json $context $status ($audioBody | ConvertFrom-Json)
                    continue
                }
                Send-Json $context 200 ($audioBody | ConvertFrom-Json)
                continue
            }

            if ($method -eq "POST" -and $path -eq "/stop") {
                Stop-StudioProcesses
                Send-Json $context 200 (Get-State)
                continue
            }

            Send-Json $context 404 @{ ok = $false; error = "not_found" }
        }
        catch {
            if ($context.Response.OutputStream.CanWrite) {
                Send-Json $context 500 @{ ok = $false; error = $_.Exception.Message }
            }
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
