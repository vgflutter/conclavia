param(
    [Parameter(Mandatory = $true)]
    [string] $BridgeUrl,

    [Parameter(Mandatory = $true)]
    [string] $ReviewStreamUrl,

    [Parameter(Mandatory = $true)]
    [string] $SupervisorUrl
)

$ErrorActionPreference = 'Stop'
$project = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\RMHLipSyncDemo.uproject'
$bridge = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\Private\ConclaviaLipSyncBridgeModule.cpp'
$reviewStream = 'C:\ConclaviaStudio\Scripts\Start-ReviewStream.ps1'
$supervisor = 'C:\ConclaviaStudio\Scripts\Start-StudioSupervisor.ps1'
$build = 'C:\Program Files\Epic Games\UE_5.6\Engine\Build\BatchFiles\Build.bat'
$stagingRoot = 'C:\ConclaviaStudio\Saved\v36'
$stagedBridge = Join-Path $stagingRoot 'ConclaviaLipSyncBridgeModule.cpp'
$stagedReviewStream = Join-Path $stagingRoot 'Start-ReviewStream.ps1'
$stagedSupervisor = Join-Path $stagingRoot 'Start-StudioSupervisor.ps1'
$bridgeBackup = "$bridge.v35-before-avatar-body-gesture"
$reviewStreamBackup = "$reviewStream.v35-before-avatar-selection"
$supervisorBackup = "$supervisor.v35-before-avatar-selection"

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -in @('UnrealEditor.exe', 'RMHLipSyncDemo.exe') -and
        $_.CommandLine -like '*RMHLipSyncDemo.uproject*'
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $BridgeUrl -OutFile $stagedBridge
Invoke-WebRequest -UseBasicParsing -Uri $ReviewStreamUrl -OutFile $stagedReviewStream
Invoke-WebRequest -UseBasicParsing -Uri $SupervisorUrl -OutFile $stagedSupervisor

if (-not (Select-String -Path $stagedBridge -SimpleMatch 'v36-avatar-body-gesture' -Quiet)) {
    throw 'The staged bridge is not the expected v36 avatar/body revision.'
}
if (-not (Select-String -Path $stagedReviewStream -SimpleMatch 'ConclaviaAvatar' -Quiet)) {
    throw 'The staged review-stream script has no avatar selection support.'
}
if (-not (Select-String -Path $stagedSupervisor -SimpleMatch 'Get-RunningAvatar' -Quiet)) {
    throw 'The staged supervisor has no avatar selection support.'
}
if (-not (Test-Path 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\Content\MetaHumans\Aera\BP_Aera.uasset') -or
    -not (Test-Path 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\Content\MetaHumans\Ada\BP_Ada.uasset')) {
    throw 'The validated Aera/Ada runtime assets are not both installed.'
}

foreach ($pair in @(
    @($bridge, $bridgeBackup),
    @($reviewStream, $reviewStreamBackup),
    @($supervisor, $supervisorBackup)
)) {
    if (-not (Test-Path $pair[1])) {
        Copy-Item $pair[0] $pair[1]
    }
}

try {
    Copy-Item $stagedBridge $bridge -Force
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
        throw "Unreal v36 build failed with exit code $LASTEXITCODE"
    }
}
catch {
    Copy-Item $bridgeBackup $bridge -Force
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

Write-Output 'V36_AVATAR_BODY_GESTURE_BUILD_OK'
