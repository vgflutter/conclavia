param(
    [Parameter(Mandatory = $true)]
    [string] $BridgeUrl,

    [Parameter(Mandatory = $true)]
    [string] $ExpressionPatchUrl
)

$ErrorActionPreference = 'Stop'
$project = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\RMHLipSyncDemo.uproject'
$bridge = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\Private\ConclaviaLipSyncBridgeModule.cpp'
$pluginSource = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\Plugins\RuntimeMetaHumanLipSync\Source\RuntimeMetaHumanLipSync\Private\BlendRealisticMetaHumanLipSyncAnimNode.cpp'
$build = 'C:\Program Files\Epic Games\UE_5.6\Engine\Build\BatchFiles\Build.bat'
$stagingRoot = 'C:\ConclaviaStudio\Saved\v34'
$stagedBridge = Join-Path $stagingRoot 'ConclaviaLipSyncBridgeModule.cpp'
$stagedPatch = Join-Path $stagingRoot 'apply-expression-gain-v34.ps1'
$bridgeBackup = "$bridge.v33-before-expression-gain-1.35"

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -in @('UnrealEditor.exe', 'RMHLipSyncDemo.exe') -and
        $_.CommandLine -like '*RMHLipSyncDemo.uproject*'
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $BridgeUrl -OutFile $stagedBridge
Invoke-WebRequest -UseBasicParsing -Uri $ExpressionPatchUrl -OutFile $stagedPatch

if (-not (Select-String -Path $stagedBridge -SimpleMatch 'v34-commercial-expression-gain-1.35' -Quiet)) {
    throw 'The staged bridge is not the expected v34 expression-gain revision.'
}
if (-not (Select-String -Path $stagedPatch -SimpleMatch 'Conclavia expression gain v34' -Quiet)) {
    throw 'The staged commercial-solver patch is not the expected v34 revision.'
}

if (-not (Test-Path $bridgeBackup)) {
    Copy-Item $bridge $bridgeBackup
}

try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stagedPatch -PluginSource $pluginSource
    if ($LASTEXITCODE -ne 0) {
        throw "Commercial solver patch failed with exit code $LASTEXITCODE"
    }
    Copy-Item $stagedBridge $bridge -Force

    & $build `
        RMHLipSyncDemoEditor `
        Win64 `
        Development `
        "-Project=$project" `
        -WaitMutex `
        -NoHotReload
    if ($LASTEXITCODE -ne 0) {
        throw "Unreal v34 build failed with exit code $LASTEXITCODE"
    }
}
catch {
    if (Test-Path "$pluginSource.v33-before-expression-gain-1.35") {
        Copy-Item "$pluginSource.v33-before-expression-gain-1.35" $pluginSource -Force
    }
    if (Test-Path $bridgeBackup) {
        Copy-Item $bridgeBackup $bridge -Force
    }
    throw
}

Write-Output 'V34_EXPRESSION_GAIN_BUILD_OK'
