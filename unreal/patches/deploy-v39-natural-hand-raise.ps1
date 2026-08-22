param(
    [Parameter(Mandatory = $true)]
    [string] $BridgeUrl
)

$ErrorActionPreference = 'Stop'
$projectRoot = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo'
$project = Join-Path $projectRoot 'RMHLipSyncDemo.uproject'
$bridge = Join-Path $projectRoot 'Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\Private\ConclaviaLipSyncBridgeModule.cpp'
$build = 'C:\Program Files\Epic Games\UE_5.6\Engine\Build\BatchFiles\Build.bat'
$stagingRoot = 'C:\ConclaviaStudio\Saved\v39'
$stagedBridge = Join-Path $stagingRoot 'ConclaviaLipSyncBridgeModule.cpp'
$bridgeBackup = "$bridge.v38-before-natural-hand-raise"

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
if (-not (Select-String -Path $stagedBridge -SimpleMatch 'v39-natural-hand-raise' -Quiet)) {
    throw 'The staged bridge is not the expected natural hand-raise revision.'
}

Stop-ConclaviaRuntime
if (-not (Test-Path $bridgeBackup)) {
    Copy-Item $bridge $bridgeBackup
}

try {
    Copy-Item $stagedBridge $bridge -Force
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
    throw
}
finally {
    Start-ConclaviaSupervisor
}

Start-Sleep -Seconds 4
if (-not (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Start-StudioSupervisor.ps1*' })) {
    throw 'The studio supervisor did not restart after the v39 build.'
}

Write-Output 'V39_NATURAL_HAND_RAISE_BUILD_OK'
