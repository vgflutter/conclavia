param(
    [ValidateSet("pop", "serious", "lipsync", "lipsync58")]
    [string]$Profile = "pop",
    [ValidateSet("aera", "ada", "vivian", "jelena")]
    [string]$AvatarId = "aera",
    [int]$PlayerPort = 8080,
    [int]$StreamerPort = 8888,
    # AWS DCV exposes the same physical L4 twice to D3D12. Adapter 1 renders,
    # but Pixel Streaming's CUDA/NVENC interop resolves the physical CUDA
    # device as adapter 0; selecting the duplicate makes every captured texture
    # fail with CUDA 700 and produces a permanently blank browser stream.
    [int]$GraphicsAdapter = 0
)

$ErrorActionPreference = "Stop"
$isLegacyLipSync = $Profile -eq "lipsync"
$isUnreal58LipSync = $Profile -eq "lipsync58"
$isCommercialLipSync = $isLegacyLipSync -or $isUnreal58LipSync
$engineRoot = if ($isLegacyLipSync) {
    "C:\Program Files\Epic Games\UE_5.6"
} else {
    "C:\Epic\UE_5.8"
}
$projectPath = if ($isLegacyLipSync) {
    "C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\RMHLipSyncDemo.uproject"
} else {
    "C:\ConclaviaStudio\ConclaviaStudio.uproject"
}
$infrastructureRoot = "C:\PixelStreamingInfrastructure"
$editor = Join-Path $engineRoot "Engine\Binaries\Win64\UnrealEditor.exe"
$editorCmd = Join-Path $engineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$serverScript = Join-Path $infrastructureRoot "SignallingWebServer\platform_scripts\cmd\start_with_turn.bat"
$playerRoot = Join-Path $infrastructureRoot "SignallingWebServer\www"
$artifacts = "C:\ConclaviaStudio\Saved\PixelStreaming"
$pidFile = Join-Path $artifacts "review-processes.json"
$readyFile = Join-Path $artifacts "review-ready.json"
$commercialPlugin = "C:\ConclaviaStudio\Plugins\RuntimeMetaHumanLipSync\RuntimeMetaHumanLipSync.uplugin"
$commercialSkeleton = "C:\ConclaviaStudio\Content\MetaHumans\Common\Face\Face_Archetype_Skeleton.uasset"
$commercialAssetScript = "C:\ConclaviaStudio\Scripts\ensure_commercial_lipsync_assets.py"
$grade1Map = "/Game/Conclavia/Grade1/L_Grade1HeroPop"
$grade1MapFile = "C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\Content\Conclavia\Grade1\L_Grade1HeroPop.umap"
$grade1BuildScript = "C:\ConclaviaStudio\Scripts\build_grade1_hero_studio.py"

New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
Remove-Item $readyFile -Force -ErrorAction SilentlyContinue

# EC2 security-group ingress is not enough on Windows Server: the guest
# firewall must also admit CoTURN and its UDP relay allocation range. Without
# these rules signalling still succeeds, but remote browsers remain forever in
# ICE `checking` with a live yet muted video track and a black frame.
$firewallRules = @(
    @{
        Name = "Conclavia TURN 19303 TCP"
        Protocol = "TCP"
        LocalPort = "19303"
    },
    @{
        Name = "Conclavia TURN 19303 UDP"
        Protocol = "UDP"
        LocalPort = "19303"
    },
    @{
        Name = "Conclavia WebRTC relay UDP"
        Protocol = "UDP"
        LocalPort = "49152-65535"
    }
)
foreach ($rule in $firewallRules) {
    Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule
    New-NetFirewallRule `
        -DisplayName $rule.Name `
        -Direction Inbound `
        -Action Allow `
        -Protocol $rule.Protocol `
        -LocalPort $rule.LocalPort `
        -Profile Any | Out-Null
}

# A crashed/restarted supervisor can lose its pid file while leaving Unreal
# alive. Never reuse that orphan: its profile and command line may belong to a
# previous web session.
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
if (Test-Path $pidFile) {
    $old = Get-Content $pidFile -Raw | ConvertFrom-Json
    foreach ($processId in @($old.unreal, $old.server)) {
        if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# Jelena was authored in the original UE 5.6 lip-sync lab. Keep the UE 5.8
# project self-healing on existing studio instances by migrating the character
# and her shared optional clothing/groom dependencies once, while Unreal is
# stopped and the asset files are not locked. Subsequent launches only check
# the two sentinels and remain fast.
if ($isUnreal58LipSync -and $AvatarId -eq "jelena") {
    $legacyMetaHumans = "C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\Content\MetaHumans"
    $jelenaSource = Join-Path $legacyMetaHumans "Jelena"
    $jelenaTarget = "C:\ConclaviaStudio\Content\MetaHumans\Jelena"
    $jelenaBlueprint = Join-Path $jelenaTarget "BP_Jelena.uasset"
    if (-not (Test-Path $jelenaBlueprint)) {
        if (-not (Test-Path (Join-Path $jelenaSource "BP_Jelena.uasset"))) {
            throw "Jelena source assets are unavailable on this studio instance."
        }
        New-Item -ItemType Directory -Path $jelenaTarget -Force | Out-Null
        Copy-Item -Path (Join-Path $jelenaSource "*") -Destination $jelenaTarget -Recurse -Force
    }

    $optionalSource = Join-Path $legacyMetaHumans "Common\Optional"
    $optionalTarget = "C:\ConclaviaStudio\Content\MetaHumans\Common\Optional"
    $jelenaShirtMaterial = Join-Path $optionalTarget "Clothing\DefaultGarment\ClothAssets\bodyShapeE\Materials\M_DG_bodyShapeE_Shirt.uasset"
    if (-not (Test-Path $jelenaShirtMaterial)) {
        if (-not (Test-Path $optionalSource)) {
            throw "Jelena shared clothing and groom assets are unavailable on this studio instance."
        }
        New-Item -ItemType Directory -Path $optionalTarget -Force | Out-Null
        Copy-Item -Path (Join-Path $optionalSource "*") -Destination $optionalTarget -Recurse -Force
    }
}

# The purchased Face AnimBP resolves the canonical MetaHuman skeleton from the
# project mount point. Materialize it once through Unreal before entering game
# mode; otherwise the blueprint silently fails to compile and the face remains
# perfectly static even though the solver produces controls.
if ($isUnreal58LipSync -and
    $projectPath -like "*ConclaviaStudio.uproject" -and
    (Test-Path $commercialPlugin) -and
    -not (Test-Path $commercialSkeleton)) {
    $assetLog = Join-Path $artifacts "commercial-assets.log"
    $assetProcess = Start-Process `
        -FilePath $editor `
        -ArgumentList @(
            $projectPath,
            "-ExecutePythonScript=$commercialAssetScript",
            "-unattended",
            "-nop4",
            "-nosplash",
            "-nullrhi",
            "-log=$assetLog"
        ) `
        -Wait `
        -PassThru
    if ($assetProcess.ExitCode -ne 0 -or -not (Test-Path $commercialSkeleton)) {
        throw "Commercial lip-sync skeleton preflight failed. See $assetLog"
    }
}

# Grade 1 deliberately stays on the proven UE 5.6 commercial face pipeline,
# but no longer exposes the vendor's calibration room. Author the small
# physical podcast set once on the instance and then launch that cooked editor
# map for every browser session. A versioned map path makes this preflight
# deterministic: future set revisions can be introduced without silently
# mutating a benchmark that already passed.
if ($isLegacyLipSync -and -not (Test-Path $grade1MapFile)) {
    if (-not (Test-Path $grade1BuildScript)) {
        throw "Grade 1 studio builder is missing: $grade1BuildScript"
    }
    $grade1Log = Join-Path $artifacts "grade1-studio-build.log"
    Remove-Item $grade1Log -Force -ErrorAction SilentlyContinue
    # `-ExecutePythonScript` enters the editor's normal startup path on this
    # UE 5.6 build and can leave a game process behind without ever executing
    # the requested file.  The PythonScript commandlet is the deterministic
    # authoring path: it runs the script, saves the map and exits with a useful
    # process code before Pixel Streaming is allowed to start.
    $grade1Process = Start-Process `
        -FilePath $editorCmd `
        -ArgumentList @(
            "`"$projectPath`"",
            "-run=pythonscript",
            "-script=`"$grade1BuildScript`"",
            "-unattended",
            "-nop4",
            "-nosplash",
            "-nullrhi",
            "-stdout",
            "-FullStdOutLogOutput",
            "-abslog=`"$grade1Log`""
        ) `
        -Wait `
        -PassThru
    # The vendor sample contains optional TTS widgets whose stale Blueprint
    # nodes make the commandlet return a non-zero code even after our script
    # has completed.  Accept only the explicit builder marker plus the map
    # artifact; runtime health performs the second, independent scene check.
    $grade1ReadyMarker = (Test-Path $grade1Log) -and (
        Select-String `
            -Path $grade1Log `
            -SimpleMatch "CONCLAVIA_GRADE1: READY" `
            -Quiet
    )
    if (-not (Test-Path $grade1MapFile) -or -not $grade1ReadyMarker) {
        throw "Grade 1 studio authoring failed (exit $($grade1Process.ExitCode)). See $grade1Log"
    }
}

# Publish a clean broadcast surface beside Epic's stock player. The stock
# `uiless` page still renders fullscreen/settings/info controls over the video;
# they belong to a developer console, not to a programme feed. This wrapper
# leaves the Pixel Streaming connection code untouched, then isolates the
# decoded video as soon as it exists. The normal app remains responsible for
# loading and error states.
$stockPlayerPath = Join-Path $playerRoot "uiless.html"
$cleanPlayerPath = Join-Path $playerRoot "conclavia.html"
if (-not (Test-Path $stockPlayerPath)) {
    throw "Pixel Streaming uiless player is missing: $stockPlayerPath"
}
$cleanPlayerScript = @'
<style>
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #020617; }
video { background: #020617; }
</style>
<script>
(() => {
  let unlockInFlight = false;

  const getVideo = () => {
    const videos = [...document.querySelectorAll("video")];
    return videos.find((candidate) => candidate.videoWidth > 0) || videos[0];
  };

  const reportAudioState = (video) => {
    const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
    const hasLiveAudio = Boolean(stream?.getAudioTracks().some(
      (track) => track.readyState === "live" && track.enabled
    ));
    const audioReady = Boolean(
      video && hasLiveAudio && !video.paused && !video.muted && video.volume > 0
    );
    window.parent.postMessage({
      type: "conclavia:audio-state",
      mediaReady: Boolean(video?.videoWidth > 0 && stream),
      audioReady,
      hasLiveAudio
    }, "*");
    return audioReady;
  };

  const unlockAudio = async () => {
    const video = getVideo();
    if (!video || unlockInFlight) return;
    unlockInFlight = true;
    try {
      video.autoplay = true;
      video.playsInline = true;
      // The user has already started the broadcast from Conclavia. Attempt
      // audible playback immediately and keep later gestures as invisible
      // retries; never add a second, competing start control to the video.
      video.defaultMuted = false;
      video.muted = false;
      video.volume = 1;
      await video.play();
      reportAudioState(video);
    } catch {
      reportAudioState(video);
    } finally {
      unlockInFlight = false;
    }
  };

  const isolateBroadcastVideo = () => {
    const video = getVideo();
    if (!video) return;

    let branch = video;
    while (branch.parentElement && branch.parentElement !== document.body) {
      const parent = branch.parentElement;
      for (const sibling of parent.children) {
        if (sibling !== branch && !sibling.contains(video)) {
          sibling.style.setProperty("display", "none", "important");
        }
      }
      Object.assign(parent.style, {
        position: "fixed",
        inset: "0",
        width: "100vw",
        height: "100vh",
        margin: "0",
        padding: "0",
        overflow: "hidden",
        background: "#020617"
      });
      branch = parent;
    }
    for (const child of document.body.children) {
      if (child !== branch && !child.contains(video)) {
        child.style.setProperty("display", "none", "important");
      }
    }
    Object.assign(video.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      maxWidth: "none",
      maxHeight: "none",
      objectFit: "contain",
      margin: "0",
      background: "#020617",
      zIndex: "2147483647",
      pointerEvents: "none"
    });
    video.controls = false;
    const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
    window.parent.postMessage({
      type: "conclavia:media-ready",
      mediaReady: Boolean(video.videoWidth > 0 && stream),
      audioReady: reportAudioState(video)
    }, "*");
    void unlockAudio();
  };
  new MutationObserver(isolateBroadcastVideo).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  window.setInterval(isolateBroadcastVideo, 500);
  window.addEventListener("load", isolateBroadcastVideo);
  window.addEventListener("message", (event) => {
    if (event.data?.type === "conclavia:unmute") void unlockAudio();
  });
  document.addEventListener("pointerdown", () => void unlockAudio(), {
    capture: true
  });
  document.addEventListener("keydown", () => void unlockAudio(), {
    capture: true
  });
})();
</script>
'@
$stockPlayer = Get-Content $stockPlayerPath -Raw
Set-Content -Path $cleanPlayerPath -Value ($stockPlayer + "`r`n" + $cleanPlayerScript) -Encoding UTF8

# Start the bundled CoTURN relay as well as Wilbur. A signalling-only launch can
# complete SDP negotiation while leaving remote browsers with a permanently
# black frame when their network cannot use the direct ICE candidate.
$serverCommand = "`"$serverScript`" -- --player_port $PlayerPort --streamer_port $StreamerPort"
$server = Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList @("/c", $serverCommand) `
    -WorkingDirectory (Split-Path $serverScript) `
    -RedirectStandardOutput (Join-Path $artifacts "review-signalling.stdout.log") `
    -RedirectStandardError (Join-Path $artifacts "review-signalling.stderr.log") `
    -PassThru

$playerUri = "http://127.0.0.1:$PlayerPort/conclavia.html?AutoConnect=true&AutoPlayVideo=true"
$deadline = (Get-Date).AddMinutes(2)
do {
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $playerUri -TimeoutSec 3
    }
    catch {
        $response = $null
    }
} until ($response.StatusCode -eq 200 -or (Get-Date) -gt $deadline)
if ($response.StatusCode -ne 200) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    throw "Pixel Streaming signalling server did not become ready."
}

$map = if ($isLegacyLipSync) {
    $grade1Map
} elseif ($Profile -eq "serious") {
    "/Game/Conclavia/Studio/L_EditorialStudio"
} else {
    "/Game/Conclavia/Studio/L_PremiumStudio"
}
$renderWidth = 1920
$renderHeight = 1080
$h264Profile = if ($isUnreal58LipSync) { "BASELINE" } else { "HIGH" }
$arguments = @(
    $projectPath,
    $map,
    "-game",
    "-unattended",
    "-RenderOffscreen",
    "-NoSplash",
    "-AudioMixer",
    "-ForceRes",
    "-ResX=$renderWidth",
    "-ResY=$renderHeight",
    "-graphicsadapter=$GraphicsAdapter",
    "-ConclaviaStudioProfile=$Profile",
    "-ConclaviaAvatar=$AvatarId",
    "-PixelStreamingURL=ws://127.0.0.1:$StreamerPort",
    # H.264 High is the most stable hardware path for the current UE 5.6/5.8
    # Pixel Streaming player. AV1 produced sporadic grey/corrupt delta frames
    # during camera cuts despite its lower bandwidth at equal quality.
    "-PixelStreamingEncoderCodec=H264",
    # Pixel Streaming 2 validates codec preferences strictly in UE 5.8. Chrome
    # is only guaranteed to advertise H.264 Baseline; forcing High makes the
    # 5.8 offer fail before the first frame, while the legacy 5.6 path remains
    # on its already validated High profile.
    "-PixelStreamingH264Profile=$h264Profile",
    "-PixelStreamingEncoderMultipass=FULL",
    "-PixelStreamingWebRTCStartBitrate=24000000",
    "-PixelStreamingWebRTCMinBitrate=12000000",
    "-PixelStreamingWebRTCMaxBitrate=45000000",
    "-PixelStreamingEncoderMinQuality=60",
    "-PixelStreamingEncoderMaxQuality=95",
    "-PixelStreamingWebRTCDisableAudioSync=false",
    # MetaHuman's solver asks for six *background* workers. The command-line
    # switch configures foreground workers, so assigning six here starved the
    # background pool down to one on the 8-vCPU g6.2xlarge. Keep one foreground
    # worker and leave the remaining scheduler capacity to the audio solver.
    "-foregroundworkers=0",
    "-TaskGraphForceNewBackend",
    "-ExecCmds=t.MaxFPS 30,sg.ViewDistanceQuality 4,sg.AntiAliasingQuality 4,sg.ShadowQuality 4,sg.GlobalIlluminationQuality 4,sg.ReflectionQuality 4,sg.PostProcessQuality 4,sg.TextureQuality 4,sg.EffectsQuality 4,sg.ShadingQuality 4,r.ScreenPercentage 100,r.AntiAliasingMethod 4,r.TSR.History.ScreenPercentage 150,r.TSR.ShadingRejection.Flickering 1,r.TSR.ShadingRejection.Flickering.Period 3,r.TSR.ShadingRejection.Flickering.FrameRateCap 30,r.MotionBlurQuality 0,r.DefaultFeature.MotionBlur 0,r.Lumen.ScreenProbeGather.Temporal.MaxFramesAccumulated 8,r.Streaming.PoolSize 8192,r.Streaming.LimitPoolSizeToVRAM 1,r.Streaming.FullyLoadUsedTextures 1,r.Streaming.UseAllMips 1,r.Streaming.Boost 4,r.MipMapLODBias -1,r.SkeletalMeshLODBias -2,r.ForceLOD 0,r.HairStrands.Strands 1,r.HairStrands.Visibility.MSAA.SamplePerPixel 2,r.SSS.Quality 1,r.SSS.HalfRes 0,r.Tonemapper.Sharpen 0.40,a.ParallelAnimEvaluation 1,a.ParallelAnimUpdate 1,PixelStreaming2.WebRTC.DisableAudioSync 0",
    "-log"
)
if ($isLegacyLipSync) {
    $arguments += "-ConclaviaBridge"
    $arguments += "-ConclaviaBridgePort=8081"
}
if ($isUnreal58LipSync) {
    $arguments += "-ConclaviaLipSyncLab"
}
$unreal = Start-Process -FilePath $editor -ArgumentList $arguments -PassThru

# Publish process ownership immediately. Readiness can take minutes on a cold
# shader cache, and the stop endpoint must still be able to cancel that warm-up
# without leaving Unreal, Chrome, Wilbur or TURN orphaned.
@{
    server = $server.Id
    unreal = $unreal.Id
    profile = $Profile
    avatarId = $AvatarId
    player = $playerUri
} | ConvertTo-Json | Set-Content -Path $pidFile -Encoding UTF8

$deadline = (Get-Date).AddMinutes(4)
do {
    Start-Sleep -Seconds 2
    if ($unreal.HasExited) {
        throw "Unreal exited before connecting to Pixel Streaming."
    }
    $connected = @(Get-NetTCPConnection -LocalPort $StreamerPort -State Established -ErrorAction SilentlyContinue).Count -gt 0
} until ($connected -or (Get-Date) -gt $deadline)
if (-not $connected) {
    if (Get-Process -Id $unreal.Id -ErrorAction SilentlyContinue) {
        Stop-Process -Id $unreal.Id -Force -ErrorAction SilentlyContinue
    }
    if (Get-Process -Id $server.Id -ErrorAction SilentlyContinue) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
    throw "Unreal did not connect to Pixel Streaming."
}

# The first decoded frame must already be presentable. A connected streamer is
# only transport readiness: the commercial model, face AnimBP, groom resources,
# high-resolution skin textures and TSR history may still be cold. Validate the
# actual private 1080p feed before publishing its URL to the browser.
if ($isCommercialLipSync) {
    $bridgeHealth = $null
    $healthDeadline = (Get-Date).AddMinutes(4)
    do {
        Start-Sleep -Seconds 2
        if ($unreal.HasExited) {
            throw "Unreal exited while the commercial face solver was warming."
        }
        try {
            $bridgeHealth = Invoke-RestMethod `
                -Uri "http://127.0.0.1:8081/health" `
                -TimeoutSec 5
        }
        catch {
            $bridgeHealth = $null
        }
        $legacyReady = $isLegacyLipSync -and
            $bridgeHealth.commercialLipSyncReady -eq $true -and
            $bridgeHealth.grade1SetReady -eq $true -and
            $bridgeHealth.cameraCount -eq 3
        $unreal58Ready = $isUnreal58LipSync -and
            $bridgeHealth.commercialLipSyncReady -eq $true -and
            $bridgeHealth.stageReady -eq $true -and
            $bridgeHealth.cameraCount -ge 9 -and
            $bridgeHealth.runtimeRevision -like "ue58-commercial-lipsync-v*"
    } until ($legacyReady -or $unreal58Ready -or (Get-Date) -gt $healthDeadline)
    if (-not $legacyReady -and -not $unreal58Ready) {
        Stop-Process -Id $unreal.Id -Force -ErrorAction SilentlyContinue
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
        $healthSummary = if ($bridgeHealth) {
            $bridgeHealth | ConvertTo-Json -Compress
        } else {
            "health endpoint unavailable"
        }
        throw "Commercial MetaHuman studio did not become ready: $healthSummary"
    }

    # A healthy transport is not enough. The vendor sample can expose the
    # correct camera name before late skeletal registration has settled and
    # leave the first encoded frame aimed at empty sky. Reassert the validated
    # hero portrait before running the visual readiness gate.
    Invoke-RestMethod `
        -Uri "http://127.0.0.1:8081/director/cue" `
        -Method Post `
        -ContentType "application/json" `
        -Body '{"shot":"close-up"}' `
        -TimeoutSec 10 | Out-Null
    Start-Sleep -Seconds 2
    if ($isUnreal58LipSync) {
        $portraitHealth = Invoke-RestMethod `
            -Uri "http://127.0.0.1:8081/health" `
            -TimeoutSec 5
        $heroCameraReady = $portraitHealth.activeCamera -in @(
            "CAM_Seat_1_Close",
            "CAM_Wide_Slider_Left"
        )
        if (-not $heroCameraReady) {
            Stop-Process -Id $unreal.Id -Force -ErrorAction SilentlyContinue
            Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
            throw "UE 5.8 hero framing was not retained: $($portraitHealth.activeCamera)"
        }
    }

    $readinessScript = "C:\ConclaviaStudio\Scripts\Verify-SingleHeroReadiness.cjs"
    $readinessDirectory = Join-Path $artifacts "single-hero-readiness"
    $readinessStdout = Join-Path $readinessDirectory "readiness.stdout.log"
    $readinessStderr = Join-Path $readinessDirectory "readiness.stderr.log"
    New-Item -ItemType Directory -Force -Path $readinessDirectory | Out-Null
    if (-not (Test-Path $readinessScript)) {
        Stop-Process -Id $unreal.Id -Force -ErrorAction SilentlyContinue
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
        throw "Single-hero readiness verifier is missing: $readinessScript"
    }

    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $readinessProcess = Start-Process `
        -FilePath $node `
        -ArgumentList @($readinessScript, $playerUri, $readinessDirectory) `
        -RedirectStandardOutput $readinessStdout `
        -RedirectStandardError $readinessStderr `
        -Wait `
        -PassThru
    if ($readinessProcess.ExitCode -ne 0) {
        $readinessFailure = if (Test-Path $readinessStderr) {
            Get-Content $readinessStderr -Raw
        } else {
            "No verifier diagnostics were produced."
        }
        Stop-Process -Id $unreal.Id -Force -ErrorAction SilentlyContinue
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
        throw "Single-hero render readiness failed: $readinessFailure"
    }

    # Let the private verifier release its peer before the public Mac browser
    # opens a fresh WebRTC connection to the now-warm renderer.
    Start-Sleep -Seconds 2
}

@{
    server = $server.Id
    unreal = $unreal.Id
    profile = $Profile
    avatarId = $AvatarId
    player = $playerUri
} | ConvertTo-Json | Set-Content -Path $pidFile -Encoding UTF8

@{
    ready = $true
    server = $server.Id
    unreal = $unreal.Id
    profile = $Profile
    avatarId = $AvatarId
    player = $playerUri
    verifiedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content -Path $readyFile -Encoding UTF8

Invoke-RestMethod -Uri "http://127.0.0.1:8081/health" -TimeoutSec 10 | ConvertTo-Json -Compress
