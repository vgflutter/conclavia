param(
    [string]$ControlUrl = "http://127.0.0.1:8081",
    [int]$DurationSeconds = 4,
    [int]$ChunkMilliseconds = 80
)

$ErrorActionPreference = "Stop"
$sampleRate = 48000
$samplesPerChunk = [int]($sampleRate * $ChunkMilliseconds / 1000)
$chunkCount = [int][Math]::Ceiling($DurationSeconds * 1000 / $ChunkMilliseconds)
$phase = 0.0
$frequency = 185.0

$cue = @{
    speakerId = "participant-3"
    targetId = "participant-2"
    speakerName = "Giulia Ferri"
    targetName = "Lorenzo Vitale"
    shot = "two-shot"
    intent = "reply"
    expectedDurationMs = $DurationSeconds * 1000
} | ConvertTo-Json -Compress

Invoke-RestMethod `
    -Method Post `
    -Uri "$ControlUrl/director/cue" `
    -ContentType "application/json" `
    -Body $cue `
    -TimeoutSec 10 | Out-Null

for ($chunkIndex = 0; $chunkIndex -lt $chunkCount; $chunkIndex += 1) {
    $bytes = [byte[]]::new($samplesPerChunk * 4)
    for ($sampleIndex = 0; $sampleIndex -lt $samplesPerChunk; $sampleIndex += 1) {
        $envelope = [Math]::Min(1.0, ($chunkIndex * $samplesPerChunk + $sampleIndex) / 3200.0)
        $value = [single](0.16 * $envelope * [Math]::Sin($phase))
        [BitConverter]::GetBytes($value).CopyTo($bytes, $sampleIndex * 4)
        $phase += 2.0 * [Math]::PI * $frequency / $sampleRate
    }
    Invoke-WebRequest `
        -UseBasicParsing `
        -Method Post `
        -Uri "$ControlUrl/audio/pcm" `
        -ContentType "application/octet-stream" `
        -Body $bytes `
        -TimeoutSec 10 | Out-Null
    Start-Sleep -Milliseconds $ChunkMilliseconds
}

Invoke-RestMethod -Uri "$ControlUrl/health" -TimeoutSec 10 |
    ConvertTo-Json -Compress
