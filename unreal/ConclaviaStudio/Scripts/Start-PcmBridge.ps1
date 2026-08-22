param(
    [int]$Port = 8091,
    [string]$TokenFile = "C:\ConclaviaStudio\Saved\supervisor.token"
)

$ErrorActionPreference = "Stop"
$root = "C:\ConclaviaStudio"
$source = Join-Path $root "Scripts\ConclaviaPcmBridge.cs"
$binary = Join-Path $root "Binaries\PcmBridge\ConclaviaPcmBridge.exe"
$artifacts = Join-Path $root "Saved\PixelStreaming"
$pidFile = Join-Path $artifacts "pcm-bridge.pid"
$compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

New-Item -ItemType Directory -Force -Path (Split-Path $binary), $artifacts | Out-Null
if (-not (Test-Path $binary) -or (Get-Item $source).LastWriteTimeUtc -gt (Get-Item $binary).LastWriteTimeUtc) {
    & $compiler /nologo /optimize+ /target:exe "/out:$binary" $source
    if ($LASTEXITCODE -ne 0) { throw "PCM bridge compilation failed." }
}
if (Test-Path $pidFile) {
    $oldPid = [int](Get-Content $pidFile -Raw)
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
$token = (Get-Content $TokenFile -Raw).Trim()
$process = Start-Process -FilePath $binary -ArgumentList @($Port, $token) `
    -RedirectStandardOutput (Join-Path $artifacts "pcm-bridge.stdout.log") `
    -RedirectStandardError (Join-Path $artifacts "pcm-bridge.stderr.log") `
    -PassThru
$process.Id | Set-Content $pidFile

$deadline = (Get-Date).AddSeconds(20)
do {
    Start-Sleep -Milliseconds 400
    if ($process.HasExited) {
        throw "PCM bridge exited: " + (Get-Content (Join-Path $artifacts "pcm-bridge.stderr.log") -Raw)
    }
    try { $health = Invoke-RestMethod "http://127.0.0.1:$Port/health?token=$token" -TimeoutSec 2 } catch { $health = $null }
} until ($health.ok -or (Get-Date) -gt $deadline)
if (-not $health.ok) { throw "PCM bridge did not become ready." }
$health | ConvertTo-Json -Compress
