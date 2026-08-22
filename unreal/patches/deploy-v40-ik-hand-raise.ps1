param(
    [Parameter(Mandatory = $true)]
    [string] $BridgeUrl,

    [Parameter(Mandatory = $true)]
    [string] $BridgeBuildRulesUrl
)

$ErrorActionPreference = 'Stop'
$projectRoot = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo'
$project = Join-Path $projectRoot 'RMHLipSyncDemo.uproject'
$bridge = Join-Path $projectRoot 'Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\Private\ConclaviaLipSyncBridgeModule.cpp'
$bridgeBuildRules = Join-Path $projectRoot 'Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\ConclaviaLipSyncBridge.Build.cs'
$build = 'C:\Program Files\Epic Games\UE_5.6\Engine\Build\BatchFiles\Build.bat'
$stagingRoot = 'C:\ConclaviaStudio\Saved\v43'
$stagedBridge = Join-Path $stagingRoot 'ConclaviaLipSyncBridgeModule.cpp'
$stagedBridgeBuildRules = Join-Path $stagingRoot 'ConclaviaLipSyncBridge.Build.cs'
$bridgeBackup = "$bridge.v42-before-continuous-ik-hand-raise"
$bridgeBuildRulesBackup = "$bridgeBuildRules.v42-before-continuous-ik-hand-raise"

function Stop-ConclaviaRuntime {
    Stop-ScheduledTask -TaskName 'ConclaviaStudioSupervisor' -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -like '*Start-StudioSupervisor.ps1*' -or
            $_.CommandLine -like '*Start-ReviewStream.ps1*' -or
            (($_.Name -in @('UnrealEditor.exe', 'UnrealEditor-Cmd.exe', 'RMHLipSyncDemo.exe')) -and
                $_.CommandLine -like '*RMHLipSyncDemo.uproject*') -or
            ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*SignallingWebServer*')
        } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Start-ConclaviaSupervisor {
    Stop-ScheduledTask -TaskName 'ConclaviaStudioSupervisor' -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*Start-StudioSupervisor.ps1*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-ScheduledTask -TaskName 'ConclaviaStudioSupervisor'
}

New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $BridgeUrl -OutFile $stagedBridge
Invoke-WebRequest -UseBasicParsing -Uri $BridgeBuildRulesUrl -OutFile $stagedBridgeBuildRules
if (-not (Select-String -Path $stagedBridge -SimpleMatch 'v43-continuous-ik-hand-raise' -Quiet)) {
    throw 'The staged bridge is not the expected continuous IK hand-raise revision.'
}
if (-not (Select-String -Path $stagedBridgeBuildRules -SimpleMatch 'AnimationCore' -Quiet)) {
    throw 'The staged bridge rules do not include AnimationCore.'
}

Stop-ConclaviaRuntime
foreach ($pair in @(
    @($bridge, $bridgeBackup),
    @($bridgeBuildRules, $bridgeBuildRulesBackup)
)) {
    if (-not (Test-Path $pair[1])) {
        Copy-Item $pair[0] $pair[1]
    }
}

try {
    Copy-Item $stagedBridge $bridge -Force
    Copy-Item $stagedBridgeBuildRules $bridgeBuildRules -Force
    & $build `
        RMHLipSyncDemoEditor `
        Win64 `
        Development `
        "-Project=$project" `
        -WaitMutex `
        -NoHotReload
    if ($LASTEXITCODE -ne 0) {
        throw "Unreal bridge build failed with exit code $LASTEXITCODE"
    }
}
catch {
    Copy-Item $bridgeBackup $bridge -Force
    Copy-Item $bridgeBuildRulesBackup $bridgeBuildRules -Force
    throw
}
finally {
    Start-ConclaviaSupervisor
}

Start-Sleep -Seconds 4
if (-not (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Start-StudioSupervisor.ps1*' })) {
    throw 'The studio supervisor did not restart after the v43 build.'
}

Write-Output 'V43_CONTINUOUS_IK_HAND_RAISE_BUILD_OK'
