param(
    [string]$EngineRoot = "C:\Epic\UE_5.8",
    [string]$ProjectPath = "C:\ConclaviaStudio\ConclaviaStudio.uproject",
    [ValidateSet("pop", "serious")]
    [string]$Profile = "pop",
    [int]$Port = 8081,
    [int]$StartupTimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"

$editor = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
if (-not (Test-Path $editor)) {
    throw "Unreal Editor not found at $editor"
}

if (-not (Test-Path $ProjectPath)) {
    throw "Conclavia Studio project not found at $ProjectPath"
}

$arguments = @(
    $ProjectPath,
    "-game",
    "-unattended",
    "-RenderOffscreen",
    "-NoSplash",
    "-ConclaviaControlPort=$Port",
    "-ConclaviaStudioProfile=$Profile",
    "-log"
)

$process = Start-Process -FilePath $editor -ArgumentList $arguments -PassThru
$healthUri = "http://127.0.0.1:$Port/health"
$cueUri = "http://127.0.0.1:$Port/director/cue"
$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)

try {
    $health = $null
    while ((Get-Date) -lt $deadline) {
        if ($process.HasExited) {
            throw "Unreal Editor exited before the control plane became ready (exit code $($process.ExitCode))."
        }

        try {
            $health = Invoke-RestMethod -Method Get -Uri $healthUri -TimeoutSec 3
            break
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }

    if ($null -eq $health) {
        throw "Control plane did not become ready within $StartupTimeoutSeconds seconds."
    }

    $cueBody = @{
        speakerId = "participant-1"
        targetId = "participant-2"
        speakerName = "Elena Riva"
        targetName = "Lorenzo Vitale"
        shot = "close-up"
        intent = "challenge"
    } | ConvertTo-Json

    $cue = Invoke-RestMethod `
        -Method Post `
        -Uri $cueUri `
        -ContentType "application/json" `
        -Body $cueBody `
        -TimeoutSec 10

    [ordered]@{
        processId = $process.Id
        profile = $Profile
        health = $health
        cue = $cue
    } | ConvertTo-Json -Depth 8
}
finally {
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit()
    }
}
