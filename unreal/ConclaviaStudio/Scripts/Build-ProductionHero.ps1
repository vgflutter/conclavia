param(
    [string]$EngineRoot = "C:\Epic\UE_5.8",
    [string]$ProjectPath = "C:\ConclaviaStudio\ConclaviaStudio.uproject",
    [int]$TimeoutMinutes = 45
)

$ErrorActionPreference = "Stop"

$editor = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$projectRoot = Split-Path $ProjectPath
$buildScript = (Join-Path $projectRoot "Scripts\build_production_host.py").Replace("\", "/")
$artifactRoot = Join-Path $projectRoot "Saved\ProductionHero"
$stdout = Join-Path $artifactRoot "build.stdout.log"
$stderr = Join-Path $artifactRoot "build.stderr.log"
$statusPath = Join-Path $artifactRoot "status.json"

foreach ($requiredPath in @($editor, $ProjectPath, $buildScript)) {
    if (-not (Test-Path $requiredPath)) {
        throw "Required production build path not found: $requiredPath"
    }
}

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
Remove-Item $stdout, $stderr, $statusPath -Force -ErrorAction SilentlyContinue

$startedAt = Get-Date
$process = Start-Process `
    -FilePath $editor `
    -ArgumentList @(
        $ProjectPath,
        "-unattended",
        "-nop4",
        "-nosplash",
        "-RenderOffscreen",
        "-graphicsadapter=0",
        "-ExecutePythonScript=$buildScript",
        "-stdout",
        "-FullStdOutLogOutput"
    ) `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

try {
    $completed = $process.WaitForExit($TimeoutMinutes * 60 * 1000)
    if (-not $completed) {
        & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        throw "Cinematic MetaHuman build exceeded $TimeoutMinutes minutes."
    }
    # WaitForExit(timeout) can leave redirected process metadata pending on
    # Windows. The parameterless call flushes stdout/stderr and makes ExitCode
    # reliable before the READY marker is evaluated.
    $process.WaitForExit()
    if ($null -ne $process.ExitCode -and $process.ExitCode -ne 0) {
        $details = if (Test-Path $stderr) { Get-Content $stderr -Raw } else { "" }
        throw "Cinematic MetaHuman build failed with exit code $($process.ExitCode). $details"
    }

    $latestLog = Get-ChildItem (Join-Path $projectRoot "Saved\Logs") -Filter "*.log" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($null -eq $latestLog -or -not (
        Select-String `
            -Path $latestLog.FullName `
            -Pattern "CONCLAVIA_PRODUCTION_HERO: READY" `
            -Quiet
    )) {
        throw "Unreal exited without the production hero ready marker."
    }

    $status = [ordered]@{
        state = "ready"
        startedAt = $startedAt.ToUniversalTime().ToString("o")
        completedAt = (Get-Date).ToUniversalTime().ToString("o")
        pipeline = "Cinematic"
        character = "MHC_MarcoBellini"
        unrealLog = $latestLog.FullName
    }
    $status | ConvertTo-Json | Set-Content -Path $statusPath -Encoding UTF8
    $status | ConvertTo-Json
}
catch {
    $status = [ordered]@{
        state = "failed"
        startedAt = $startedAt.ToUniversalTime().ToString("o")
        completedAt = (Get-Date).ToUniversalTime().ToString("o")
        message = $_.Exception.Message
    }
    $status | ConvertTo-Json | Set-Content -Path $statusPath -Encoding UTF8
    throw
}
