param(
    [Parameter(Mandatory = $true)]
    [string] $BridgeUrl,

    [Parameter(Mandatory = $true)]
    [string] $ReviewStreamUrl,

    [Parameter(Mandatory = $true)]
    [string] $SupervisorUrl,

    [Parameter(Mandatory = $true)]
    [string] $BridgeBuildRulesUrl,

    [Parameter(Mandatory = $true)]
    [string] $BridgeManifestUrl
)

$ErrorActionPreference = 'Stop'
$projectRoot = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo'
$project = Join-Path $projectRoot 'RMHLipSyncDemo.uproject'
$bridge = Join-Path $projectRoot 'Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\Private\ConclaviaLipSyncBridgeModule.cpp'
$bridgeBuildRules = Join-Path $projectRoot 'Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\ConclaviaLipSyncBridge.Build.cs'
$bridgeManifest = Join-Path $projectRoot 'Plugins\ConclaviaLipSyncBridge\ConclaviaLipSyncBridge.uplugin'
$reviewStream = 'C:\ConclaviaStudio\Scripts\Start-ReviewStream.ps1'
$supervisor = 'C:\ConclaviaStudio\Scripts\Start-StudioSupervisor.ps1'
$vivianBlueprint = Join-Path $projectRoot 'Content\MetaHumans\Vivian\BP_Vivian.uasset'
$editor = 'C:\Program Files\Epic Games\UE_5.6\Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$build = 'C:\Program Files\Epic Games\UE_5.6\Engine\Build\BatchFiles\Build.bat'
$stagingRoot = 'C:\ConclaviaStudio\Saved\v37'
$stagedBridge = Join-Path $stagingRoot 'ConclaviaLipSyncBridgeModule.cpp'
$stagedBridgeBuildRules = Join-Path $stagingRoot 'ConclaviaLipSyncBridge.Build.cs'
$stagedBridgeManifest = Join-Path $stagingRoot 'ConclaviaLipSyncBridge.uplugin'
$stagedReviewStream = Join-Path $stagingRoot 'Start-ReviewStream.ps1'
$stagedSupervisor = Join-Path $stagingRoot 'Start-StudioSupervisor.ps1'
$vivianLog = Join-Path $stagingRoot 'vivian-build.log'

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        ($_.Name -in @('UnrealEditor.exe', 'UnrealEditor-Cmd.exe', 'RMHLipSyncDemo.exe') -and
            $_.CommandLine -like '*RMHLipSyncDemo.uproject*') -or
        ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*SignallingWebServer*')
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $BridgeUrl -OutFile $stagedBridge
Invoke-WebRequest -UseBasicParsing -Uri $BridgeBuildRulesUrl -OutFile $stagedBridgeBuildRules
Invoke-WebRequest -UseBasicParsing -Uri $BridgeManifestUrl -OutFile $stagedBridgeManifest
Invoke-WebRequest -UseBasicParsing -Uri $ReviewStreamUrl -OutFile $stagedReviewStream
Invoke-WebRequest -UseBasicParsing -Uri $SupervisorUrl -OutFile $stagedSupervisor

if (-not (Select-String -Path $stagedBridge -SimpleMatch 'v37-vivian' -Quiet)) {
    throw 'The staged bridge is not the expected Vivian revision.'
}
if (-not (Select-String -Path $stagedReviewStream -SimpleMatch '"aera", "ada", "vivian"' -Quiet)) {
    throw 'The staged review-stream script does not accept Vivian.'
}
if (-not (Select-String -Path $stagedSupervisor -SimpleMatch 'aera|ada|vivian' -Quiet)) {
    throw 'The staged supervisor does not accept Vivian.'
}
if (-not (Select-String -Path $stagedBridgeBuildRules -SimpleMatch 'MetaHumanCharacterEditor' -Quiet)) {
    throw 'The staged bridge build rules do not include the Vivian builder dependencies.'
}
if (-not (Select-String -Path $stagedBridgeManifest -SimpleMatch 'MetaHumanCharacter' -Quiet)) {
    throw 'The staged bridge manifest does not enable MetaHuman Character.'
}

$bridgeBackup = "$bridge.v36-before-vivian"
$bridgeBuildRulesBackup = "$bridgeBuildRules.v36-before-vivian"
$bridgeManifestBackup = "$bridgeManifest.v36-before-vivian"
$reviewStreamBackup = "$reviewStream.v36-before-vivian"
$supervisorBackup = "$supervisor.v36-before-vivian"
foreach ($pair in @(
    @($bridge, $bridgeBackup),
    @($bridgeBuildRules, $bridgeBuildRulesBackup),
    @($bridgeManifest, $bridgeManifestBackup),
    @($reviewStream, $reviewStreamBackup),
    @($supervisor, $supervisorBackup)
)) {
    if (-not (Test-Path $pair[1])) {
        Copy-Item $pair[0] $pair[1]
    }
}

try {
    Copy-Item $stagedBridge $bridge -Force
    Copy-Item $stagedBridgeBuildRules $bridgeBuildRules -Force
    Copy-Item $stagedBridgeManifest $bridgeManifest -Force
    Copy-Item $stagedReviewStream $reviewStream -Force
    Copy-Item $stagedSupervisor $supervisor -Force

    & $build `
        RMHLipSyncDemoEditor `
        Win64 `
        Development `
        "-Project=$project" `
        -WaitMutex `
        -NoHotReload
    if ($LASTEXITCODE -ne 0) {
        throw "Unreal Vivian build failed with exit code $LASTEXITCODE"
    }

    if (-not (Test-Path $vivianBlueprint)) {
        Remove-Item $vivianLog -Force -ErrorAction SilentlyContinue
        $vivianProcess = Start-Process `
            -FilePath $editor `
            -ArgumentList @(
                $project,
                '-ConclaviaBuildVivian',
                '-ini:Engine:[Kismet]:bPersistentUberGraphFrame=false',
                '-unattended',
                '-nop4',
                '-nosplash',
                '-RenderOffscreen',
                '-graphicsadapter=0',
                '-stdout',
                '-FullStdOutLogOutput'
            ) `
            -RedirectStandardOutput $vivianLog `
            -RedirectStandardError (Join-Path $stagingRoot 'vivian-build.stderr.log') `
            -Wait `
            -PassThru
        if ($vivianProcess.ExitCode -ne 0 -or -not (Test-Path $vivianBlueprint)) {
            throw "Vivian assembly failed with exit code $($vivianProcess.ExitCode). See $vivianLog"
        }
    }
}
catch {
    Copy-Item $bridgeBackup $bridge -Force
    Copy-Item $bridgeBuildRulesBackup $bridgeBuildRules -Force
    Copy-Item $bridgeManifestBackup $bridgeManifest -Force
    Copy-Item $reviewStreamBackup $reviewStream -Force
    Copy-Item $supervisorBackup $supervisor -Force
    throw
}

Stop-ScheduledTask -TaskName 'ConclaviaStudioSupervisor' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Start-StudioSupervisor.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-ScheduledTask -TaskName 'ConclaviaStudioSupervisor'
Start-Sleep -Seconds 4
if (-not (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Start-StudioSupervisor.ps1*' })) {
    throw 'The updated studio supervisor did not restart.'
}

Write-Output 'V37_VIVIAN_BUILD_OK'
