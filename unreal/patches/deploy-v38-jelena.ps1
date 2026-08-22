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
$jelenaBlueprint = Join-Path $projectRoot 'Content\MetaHumans\Jelena\BP_Jelena.uasset'
$editor = 'C:\Program Files\Epic Games\UE_5.6\Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$build = 'C:\Program Files\Epic Games\UE_5.6\Engine\Build\BatchFiles\Build.bat'
$stagingRoot = 'C:\ConclaviaStudio\Saved\v38'
$stagedBridge = Join-Path $stagingRoot 'ConclaviaLipSyncBridgeModule.cpp'
$stagedBridgeBuildRules = Join-Path $stagingRoot 'ConclaviaLipSyncBridge.Build.cs'
$stagedBridgeManifest = Join-Path $stagingRoot 'ConclaviaLipSyncBridge.uplugin'
$stagedReviewStream = Join-Path $stagingRoot 'Start-ReviewStream.ps1'
$stagedSupervisor = Join-Path $stagingRoot 'Start-StudioSupervisor.ps1'
$jelenaLog = Join-Path $stagingRoot 'jelena-build.log'

function Stop-ConclaviaRuntime {
    Stop-ScheduledTask -TaskName 'ConclaviaStudioSupervisor' -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -like '*Start-StudioSupervisor.ps1*' -or
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
Invoke-WebRequest -UseBasicParsing -Uri $BridgeManifestUrl -OutFile $stagedBridgeManifest
Invoke-WebRequest -UseBasicParsing -Uri $ReviewStreamUrl -OutFile $stagedReviewStream
Invoke-WebRequest -UseBasicParsing -Uri $SupervisorUrl -OutFile $stagedSupervisor

if (-not (Select-String -Path $stagedBridge -SimpleMatch 'v38-jelena' -Quiet)) {
    throw 'The staged bridge is not the expected Jelena revision.'
}
if (-not (Select-String -Path $stagedReviewStream -SimpleMatch '"aera", "ada", "vivian", "jelena"' -Quiet)) {
    throw 'The staged review-stream script does not accept Jelena.'
}
if (-not (Select-String -Path $stagedSupervisor -SimpleMatch 'aera|ada|vivian|jelena' -Quiet)) {
    throw 'The staged supervisor does not accept Jelena.'
}
if (-not (Select-String -Path $stagedBridgeBuildRules -SimpleMatch 'MetaHumanCharacterEditor' -Quiet)) {
    throw 'The staged bridge build rules do not include the avatar builder dependencies.'
}
if (-not (Select-String -Path $stagedBridgeManifest -SimpleMatch 'MetaHumanCharacter' -Quiet)) {
    throw 'The staged bridge manifest does not enable MetaHuman Character.'
}

Stop-ConclaviaRuntime
$backups = @(
    @($bridge, "$bridge.v37-before-jelena"),
    @($bridgeBuildRules, "$bridgeBuildRules.v37-before-jelena"),
    @($bridgeManifest, "$bridgeManifest.v37-before-jelena"),
    @($reviewStream, "$reviewStream.v37-before-jelena"),
    @($supervisor, "$supervisor.v37-before-jelena")
)
foreach ($pair in $backups) {
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
        throw "Unreal bridge build failed with exit code $LASTEXITCODE"
    }

    if (-not (Test-Path $jelenaBlueprint)) {
        Remove-Item $jelenaLog -Force -ErrorAction SilentlyContinue
        $jelenaProcess = Start-Process `
            -FilePath $editor `
            -ArgumentList @(
                $project,
                '-ConclaviaBuildAvatar=Jelena',
                '-ini:Engine:[Kismet]:bPersistentUberGraphFrame=false',
                '-unattended',
                '-nop4',
                '-nosplash',
                '-RenderOffscreen',
                '-graphicsadapter=0',
                '-stdout',
                '-FullStdOutLogOutput'
            ) `
            -RedirectStandardOutput $jelenaLog `
            -RedirectStandardError (Join-Path $stagingRoot 'jelena-build.stderr.log') `
            -Wait `
            -PassThru
        $jelenaReady = (Test-Path $jelenaLog) -and (
            Select-String -Path $jelenaLog -SimpleMatch `
                'CONCLAVIA_MEETING_AVATAR_BUILD: READY preset=Jelena' -Quiet
        )
        if ($jelenaProcess.ExitCode -ne 0 -or
            -not (Test-Path $jelenaBlueprint) -or
            -not $jelenaReady) {
            throw "Jelena assembly failed with exit code $($jelenaProcess.ExitCode). See $jelenaLog"
        }
    }
}
catch {
    foreach ($pair in $backups) {
        Copy-Item $pair[1] $pair[0] -Force
    }
    throw
}
finally {
    Start-ConclaviaSupervisor
}

Start-Sleep -Seconds 4
if (-not (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Start-StudioSupervisor.ps1*' })) {
    throw 'The updated studio supervisor did not restart.'
}

Write-Output 'V38_JELENA_BUILD_OK'
