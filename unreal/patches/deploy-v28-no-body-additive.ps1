param(
    [Parameter(Mandatory = $true)]
    [string] $BridgeUrl
)

$ErrorActionPreference = 'Stop'
$project = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\RMHLipSyncDemo.uproject'
$bridge = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\Private\ConclaviaLipSyncBridgeModule.cpp'
$build = 'C:\Program Files\Epic Games\UE_5.6\Engine\Build\BatchFiles\Build.bat'
$staging = 'C:\ConclaviaStudio\Saved\v28\ConclaviaLipSyncBridgeModule.cpp'

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -in @('UnrealEditor.exe', 'RMHLipSyncDemo.exe') -and
        $_.CommandLine -like '*RMHLipSyncDemo.uproject*'
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path (Split-Path $staging) | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $BridgeUrl -OutFile $staging
if (-not (Select-String -Path $staging -SimpleMatch 'v28-no-body-additive-audit' -Quiet)) {
    throw 'The staged bridge is not the expected v28 audit revision.'
}

if (-not (Test-Path ($bridge + '.v27-native-body-additive'))) {
    Copy-Item $bridge ($bridge + '.v27-native-body-additive')
}
Copy-Item $staging $bridge -Force

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

Write-Output 'V28_NO_BODY_ADDITIVE_BUILD_OK'
