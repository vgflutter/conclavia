param(
    [Parameter(Mandatory = $true)]
    [string] $BridgeUrl,

    [Parameter(Mandatory = $true)]
    [string] $BridgeBuildRulesUrl,

    [Parameter(Mandatory = $true)]
    [string] $BridgeManifestUrl
)

$ErrorActionPreference = 'Stop'
$root = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo'
$stage = 'C:\ConclaviaStudio\Saved\v37'
$project = Join-Path $root 'RMHLipSyncDemo.uproject'
$bridge = Join-Path $root 'Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\Private\ConclaviaLipSyncBridgeModule.cpp'
$rules = Join-Path $root 'Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\ConclaviaLipSyncBridge.Build.cs'
$manifest = Join-Path $root 'Plugins\ConclaviaLipSyncBridge\ConclaviaLipSyncBridge.uplugin'
$stagedBridge = Join-Path $stage 'ConclaviaLipSyncBridgeModule.cpp'
$stagedRules = Join-Path $stage 'ConclaviaLipSyncBridge.Build.cs'
$stagedManifest = Join-Path $stage 'ConclaviaLipSyncBridge.uplugin'

Stop-ScheduledTask -TaskName 'ConclaviaStudioSupervisor' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -like '*Start-StudioSupervisor.ps1*' -or
        (($_.Name -in @('UnrealEditor.exe', 'UnrealEditor-Cmd.exe', 'RMHLipSyncDemo.exe')) -and
            $_.CommandLine -like '*RMHLipSyncDemo.uproject*')
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $stage | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $BridgeUrl -OutFile $stagedBridge
Invoke-WebRequest -UseBasicParsing -Uri $BridgeBuildRulesUrl -OutFile $stagedRules
Invoke-WebRequest -UseBasicParsing -Uri $BridgeManifestUrl -OutFile $stagedManifest
Copy-Item $stagedBridge $bridge -Force
Copy-Item $stagedRules $rules -Force
Copy-Item $stagedManifest $manifest -Force

& 'C:\Program Files\Epic Games\UE_5.6\Engine\Build\BatchFiles\Build.bat' `
    RMHLipSyncDemoEditor `
    Win64 `
    Development `
    "-Project=$project" `
    -WaitMutex `
    -NoHotReload
if ($LASTEXITCODE -ne 0) {
    throw "Compile failed with exit code $LASTEXITCODE"
}

Write-Output 'VIVIAN_LEGACY_COMPILE_OK'
