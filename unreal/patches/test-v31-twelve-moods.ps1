$ErrorActionPreference = "Stop"

$controlUrl = "http://127.0.0.1:8081"
$pcmPath = "C:\ConclaviaStudio\Saved\semantic-short.pcm"
$allPcm = [System.IO.File]::ReadAllBytes($pcmPath)
$sampleLength = [Math]::Min(64000, $allPcm.Length)
$pcm = New-Object byte[] $sampleLength
[Array]::Copy($allPcm, $pcm, $sampleLength)

$moods = @(
    "neutral",
    "happiness",
    "sadness",
    "disgust",
    "anger",
    "surprise",
    "fear",
    "confidence",
    "excitement",
    "boredom",
    "playfulness",
    "confusion"
)

$results = @()
foreach ($mood in $moods) {
    $before = Invoke-RestMethod -Uri "$controlUrl/health" -TimeoutSec 5
    $intensity = if ($mood -eq "neutral") { 0.0 } else { 0.62 }
    $cue = @{
        speakerId = "participant-1"
        speakerName = "Mood Audit"
        shot = "close-up"
        intent = "answer"
        expectedDurationMs = 2000
        performanceBeats = @(@{
            atMs = 0
            mood = $mood
            intensity = $intensity
            focus = "camera"
            gesture = "none"
        })
    } | ConvertTo-Json -Depth 6

    $cueResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$controlUrl/director/cue" `
        -ContentType "application/json" `
        -Body $cue `
        -TimeoutSec 10
    $speechResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$controlUrl/audio/speech" `
        -ContentType "application/octet-stream" `
        -Body $pcm `
        -TimeoutSec 10

    $deadline = (Get-Date).AddSeconds(15)
    $sample = $null
    do {
        Start-Sleep -Milliseconds 100
        $sample = Invoke-RestMethod -Uri "$controlUrl/health" -TimeoutSec 5
        if (
            $sample.commercialSpeechActive -and
            $sample.performanceMood.ToLowerInvariant() -eq $mood
        ) {
            break
        }
    } while ((Get-Date) -lt $deadline)

    $accepted = (
        $null -ne $sample -and
        $sample.performanceMood.ToLowerInvariant() -eq $mood -and
        [int]$sample.performanceAppliedBeatCount -ge 1
    )
    $results += [pscustomobject]@{
        mood = $mood
        accepted = $accepted
        cueAccepted = ($cueResponse.ok -ne $false)
        speechAccepted = ($speechResponse.ok -ne $false)
        appliedMood = $sample.performanceMood
        targetIntensity = [double]$sample.performanceTargetIntensity
        appliedBeatCount = [int]$sample.performanceAppliedBeatCount
        commercialMood = $sample.commercialMood
    }

    $completionDeadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 100
        $sample = Invoke-RestMethod -Uri "$controlUrl/health" -TimeoutSec 5
    } while (
        $sample.commercialSpeechActive -and
        (Get-Date) -lt $completionDeadline
    )
}

$report = [pscustomobject]@{
    ok = (($results | Where-Object { -not $_.accepted }).Count -eq 0)
    runtimeRevision = (Invoke-RestMethod -Uri "$controlUrl/health" -TimeoutSec 5).runtimeRevision
    testedMoodCount = $results.Count
    results = $results
}
$report | ConvertTo-Json -Depth 8
if (-not $report.ok) {
    exit 1
}
