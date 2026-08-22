param(
    [Parameter(Mandatory = $true)]
    [string] $PayloadUrl
)

$ErrorActionPreference = 'Stop'
$projectRoot = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo'
$project = Join-Path $projectRoot 'RMHLipSyncDemo.uproject'
$bridge = Join-Path $projectRoot 'Plugins\ConclaviaLipSyncBridge\Source\ConclaviaLipSyncBridge\Private\ConclaviaLipSyncBridgeModule.cpp'
$scripts = 'C:\ConclaviaStudio\Scripts'
$build = 'C:\Program Files\Epic Games\UE_5.6\Engine\Build\BatchFiles\Build.bat'
$staging = 'C:\ConclaviaStudio\Saved\grade1-v4'
$archive = Join-Path $staging 'grade1-v4.zip'
$payload = Join-Path $staging 'payload'
$grade1Content = Join-Path $projectRoot 'Content\Conclavia\Grade1'
$grade1ExternalActors = Join-Path $projectRoot 'Content\__ExternalActors__\Conclavia\Grade1'
$grade1ExternalObjects = Join-Path $projectRoot 'Content\__ExternalObjects__\Conclavia\Grade1'

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        ($_.Name -in @('UnrealEditor.exe', 'RMHLipSyncDemo.exe') -and
            $_.CommandLine -like '*RMHLipSyncDemo.uproject*') -or
        ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*SignallingWebServer*')
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $payload | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $PayloadUrl -OutFile $archive
Expand-Archive -Path $archive -DestinationPath $payload -Force

$stagedBridge = Join-Path $payload 'ConclaviaLipSyncBridgeModule.cpp'
if (-not (Select-String -Path $stagedBridge -SimpleMatch 'commercial-grade1-hero-56-v4' -Quiet)) {
    throw 'The staged bridge is not the expected Grade 1 revision.'
}

Copy-Item $stagedBridge $bridge -Force
foreach ($name in @(
    'Start-ReviewStream.ps1',
    'build_grade1_hero_studio.py',
    'Verify-SingleHeroReadiness.cjs',
    'Audit-SingleHeroBenchmark.cjs'
)) {
    Copy-Item (Join-Path $payload $name) (Join-Path $scripts $name) -Force
}

# Force one deterministic authoring pass on the next start. This only removes
# the versioned Grade 1 map and materials, never the purchased sample assets.
Remove-Item $grade1Content -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $grade1ExternalActors -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $grade1ExternalObjects -Recurse -Force -ErrorAction SilentlyContinue

& $build `
    RMHLipSyncDemoEditor `
    Win64 `
    Development `
    "-Project=$project" `
    -WaitMutex `
    -NoHotReload
if ($LASTEXITCODE -ne 0) {
    throw "Unreal Grade 1 bridge build failed with exit code $LASTEXITCODE"
}

Write-Output 'GRADE1_HERO_V4_BUILD_OK'
