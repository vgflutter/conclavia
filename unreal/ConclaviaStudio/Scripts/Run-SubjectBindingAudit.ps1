param(
    [string]$EngineRoot = "C:\Epic\UE_5.8",
    [string]$ProjectPath = "C:\ConclaviaStudio\ConclaviaStudio.uproject"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $ProjectPath
$editor = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$auditScript = (Join-Path $projectRoot "Scripts\audit_metahuman_subject_binding.py").Replace("\", "/")
$stdout = Join-Path $projectRoot "Saved\SubjectBindingAudit.stdout.log"
$stderr = Join-Path $projectRoot "Saved\SubjectBindingAudit.stderr.log"

Remove-Item $stdout, $stderr -Force -ErrorAction SilentlyContinue
$process = Start-Process `
    -FilePath $editor `
    -ArgumentList @(
        $ProjectPath,
        "/Game/Conclavia/Studio/L_PremiumStudio",
        "-unattended",
        "-nop4",
        "-nosplash",
        "-nullrhi",
        "-ExecutePythonScript=$auditScript"
    ) `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru `
    -Wait

if ($process.ExitCode -ne 0) {
    Get-Content $stdout -Tail 80 -ErrorAction SilentlyContinue
    Get-Content $stderr -Tail 80 -ErrorAction SilentlyContinue
    throw "Subject binding audit exited with code $($process.ExitCode)."
}

$latestLog = Get-ChildItem (Join-Path $projectRoot "Saved\Logs") -Filter "*.log" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
Select-String `
    -Path $latestLog.FullName `
    -Pattern "CONCLAVIA_SUBJECT_BINDING_AUDIT|LogPython: Error" |
    ForEach-Object { $_.Line }
