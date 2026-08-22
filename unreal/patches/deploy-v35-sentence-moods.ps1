param(
    [Parameter(Mandatory = $true)]
    [string] $BridgeUrl
)

$ErrorActionPreference = 'Stop'
$project = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\RMHLipSyncDemo.uproject'
$bridge = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\Private\ConclaviaLipSyncBridgeModule.cpp'
$build = 'C:\Program Files\Epic Games\UE_5.6\Engine\Build\BatchFiles\Build.bat'
$stagingRoot = 'C:\ConclaviaStudio\Saved\v35'
$stagedBridge = Join-Path $stagingRoot 'ConclaviaLipSyncBridgeModule.cpp'
$bridgeBackup = "$bridge.v34-before-sentence-mood-transitions"

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -in @('UnrealEditor.exe', 'RMHLipSyncDemo.exe') -and
        $_.CommandLine -like '*RMHLipSyncDemo.uproject*'
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $BridgeUrl -OutFile $stagedBridge

if (-not (Select-String -Path $stagedBridge -SimpleMatch 'v35-sentence-mood-transitions' -Quiet)) {
    throw 'The staged bridge is not the expected v35 sentence-mood revision.'
}

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
        throw "Unreal v35 build failed with exit code $LASTEXITCODE"
    }
}
catch {
    if (Test-Path $bridgeBackup) {
        Copy-Item $bridgeBackup $bridge -Force
    }
    throw
}

Write-Output 'V35_SENTENCE_MOOD_TRANSITIONS_BUILD_OK'
