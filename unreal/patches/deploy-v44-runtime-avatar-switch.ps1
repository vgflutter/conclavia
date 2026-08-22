param(
    [Parameter(Mandatory = $true)]
    [string] $BridgeUrl,

    [Parameter(Mandatory = $true)]
    [string] $BridgeBuildRulesUrl,

    [Parameter(Mandatory = $true)]
    [string] $SupervisorUrl,

    [Parameter(Mandatory = $true)]
    [string] $StartStreamUrl,

    [Parameter(Mandatory = $true)]
    [string] $StopStreamUrl
)

$ErrorActionPreference = 'Stop'
$projectRoot = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo'
$project = Join-Path $projectRoot 'RMHLipSyncDemo.uproject'
$bridge = Join-Path $projectRoot 'Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\Private\ConclaviaLipSyncBridgeModule.cpp'
$bridgeBuildRules = Join-Path $projectRoot 'Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\ConclaviaLipSyncBridge.Build.cs'
$scriptsRoot = 'C:\ConclaviaStudio\Scripts'
$supervisor = Join-Path $scriptsRoot 'Start-StudioSupervisor.ps1'
$startStream = Join-Path $scriptsRoot 'Start-ReviewStream.ps1'
$stopStream = Join-Path $scriptsRoot 'Stop-ReviewStream.ps1'
$build = 'C:\Program Files\Epic Games\UE_5.6\Engine\Build\BatchFiles\Build.bat'
$stagingRoot = 'C:\ConclaviaStudio\Saved\v44'

function Stop-ConclaviaRuntime {
    Stop-ScheduledTask -TaskName 'ConclaviaStudioSupervisor' -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -like '*Start-StudioSupervisor.ps1*' -or
            $_.CommandLine -like '*Start-ReviewStream.ps1*' -or
            (($_.Name -in @('UnrealEditor.exe', 'UnrealEditor-Cmd.exe', 'RMHLipSyncDemo.exe')) -and
                $_.CommandLine -like '*RMHLipSyncDemo.uproject*') -or
            ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*SignallingWebServer*') -or
            ($_.Name -eq 'turnserver.exe' -and $_.CommandLine -like '*PixelStreaming*') -or
            ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*start_with_turn.bat*')
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
$staged = @{
    $bridge = Join-Path $stagingRoot 'ConclaviaLipSyncBridgeModule.cpp'
    $bridgeBuildRules = Join-Path $stagingRoot 'ConclaviaLipSyncBridge.Build.cs'
    $supervisor = Join-Path $stagingRoot 'Start-StudioSupervisor.ps1'
    $startStream = Join-Path $stagingRoot 'Start-ReviewStream.ps1'
    $stopStream = Join-Path $stagingRoot 'Stop-ReviewStream.ps1'
}
foreach ($download in @(
    @($BridgeUrl, $staged[$bridge]),
    @($BridgeBuildRulesUrl, $staged[$bridgeBuildRules]),
    @($SupervisorUrl, $staged[$supervisor]),
    @($StartStreamUrl, $staged[$startStream]),
    @($StopStreamUrl, $staged[$stopStream])
)) {
    Invoke-WebRequest -UseBasicParsing -Uri $download[0] -OutFile $download[1]
}
if (-not (Select-String -Path $staged[$bridge] -SimpleMatch 'v44-runtime-avatar-switch' -Quiet) -or
    -not (Select-String -Path $staged[$bridge] -SimpleMatch 'native-two-bone-ik' -Quiet)) {
    throw 'The staged bridge is not the expected v44 runtime-switch revision.'
}
if (-not (Select-String -Path $staged[$supervisor] -SimpleMatch 'http://127.0.0.1:8081/avatar' -Quiet)) {
    throw 'The staged supervisor does not support hot avatar switching.'
}
if (-not (Select-String -Path $staged[$stopStream] -SimpleMatch 'turnserver.exe' -Quiet)) {
    throw 'The staged stop script does not clean the TURN relay.'
}

Stop-ConclaviaRuntime
$backups = @{}
foreach ($target in $staged.Keys) {
    $backup = "$target.v43-before-runtime-avatar-switch"
    $backups[$target] = $backup
    if (-not (Test-Path $backup)) {
        Copy-Item $target $backup
    }
}

try {
    foreach ($target in $staged.Keys) {
        Copy-Item $staged[$target] $target -Force
    }
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
    foreach ($target in $backups.Keys) {
        Copy-Item $backups[$target] $target -Force
    }
    throw
}
finally {
    Start-ConclaviaSupervisor
}

Start-Sleep -Seconds 5
if (-not (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Start-StudioSupervisor.ps1*' })) {
    throw 'The studio supervisor did not restart after the v44 build.'
}

Write-Output 'V44_RUNTIME_AVATAR_SWITCH_BUILD_OK'
