param(
    [string]$EngineRoot = "C:\Epic\UE_5.8",
    [string]$ProjectPath = "C:\ConclaviaStudio\ConclaviaStudio.uproject"
)

$ErrorActionPreference = "Stop"
$editor = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$scriptsRoot = Join-Path (Split-Path $ProjectPath) "Scripts"
$savedRoot = Join-Path (Split-Path $ProjectPath) "Saved\LookdevPipeline"
$scripts = @(
    "build_premium_studio.py",
    "build_seated_idle.py",
    "stage_production_cast.py",
    "tune_production_lookdev.py"
)

New-Item -ItemType Directory -Path $savedRoot -Force | Out-Null
$results = @()
foreach ($script in $scripts) {
    $scriptPath = (Join-Path $scriptsRoot $script).Replace("\", "/")
    $stdout = Join-Path $savedRoot "$script.stdout.log"
    $stderr = Join-Path $savedRoot "$script.stderr.log"
    Remove-Item $stdout, $stderr -Force -ErrorAction SilentlyContinue
    $process = Start-Process `
        -FilePath $editor `
        -ArgumentList @(
            $ProjectPath,
            "-unattended",
            "-nop4",
            "-nosplash",
            "-nullrhi",
            "-ExecutePythonScript=$scriptPath"
        ) `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru `
        -Wait

    $result = [ordered]@{
        script = $script
        exitCode = $process.ExitCode
        stdoutTail = if (Test-Path $stdout) {
            (Get-Content $stdout -Tail 30) -join "`n"
        } else { "" }
        stderrTail = if (Test-Path $stderr) {
            (Get-Content $stderr -Tail 30) -join "`n"
        } else { "" }
    }
    $results += $result
    if ($process.ExitCode -ne 0) {
        $results | ConvertTo-Json -Depth 5
        throw "Lookdev step failed: $script (exit $($process.ExitCode))"
    }
}

$results | ConvertTo-Json -Depth 5
