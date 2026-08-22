$ErrorActionPreference = 'Stop'

$controlUrl = 'http://127.0.0.1:8081'
$pcmPath = 'C:\ConclaviaStudio\Saved\semantic-short.pcm'
$allPcm = [System.IO.File]::ReadAllBytes($pcmPath)
$sampleLength = [Math]::Min(64000, $allPcm.Length)
$pcm = New-Object byte[] $sampleLength
[Array]::Copy($allPcm, $pcm, $sampleLength)

$moods = @(
    'neutral',
    'happiness',
    'anger',
    'surprise',
    'sadness',
    'disgust',
    'fear',
    'confusion',
    'boredom',
    'excitement',
    'playfulness',
    'confidence'
)
$results = @()

foreach ($mood in $moods) {
    $intensity = if ($mood -eq 'neutral') { 0.0 } else { 1.0 }
    $cue = @{
        speakerId = 'participant-1'
        speakerName = 'Mood Audit'
        shot = 'close-up'
        intent = 'answer'
        expectedDurationMs = 2000
        performanceBeats = @(@{
            atMs = 0
            mood = $mood
            intensity = $intensity
            focus = 'camera'
            gesture = 'none'
        })
    } | ConvertTo-Json -Depth 6

    $cueResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$controlUrl/director/cue" `
        -ContentType 'application/json' `
        -Body $cue `
        -TimeoutSec 10
    $speechResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$controlUrl/audio/speech" `
        -ContentType 'application/octet-stream' `
        -Body $pcm `
        -TimeoutSec 10

    $deadline = (Get-Date).AddSeconds(15)
    $sample = $null
    $peakUpperValue = 0.0
    $peakUpperName = ''
    $peakMouthValue = 0.0
    $peakMouthName = ''
    $sawSpeechActive = $false
    $maxAppliedBeatCount = 0
    $activeSampleCount = 0
    $upperFaceActiveSampleCount = 0
    $upperFaceValueTotal = 0.0
    $upperFaceControls = @{}
    do {
        Start-Sleep -Milliseconds 100
        $sample = Invoke-RestMethod -Uri "$controlUrl/health" -TimeoutSec 5
        $maxAppliedBeatCount = [Math]::Max(
            $maxAppliedBeatCount,
            [int]$sample.performanceAppliedBeatCount
        )
        if ($sample.commercialSpeechActive) {
            $sawSpeechActive = $true
            $activeSampleCount += 1
            $currentUpperValue = [double]$sample.commercialMaxUpperFaceControl
            $currentUpperName = [string]$sample.commercialMaxUpperFaceControlName
            $upperFaceValueTotal += $currentUpperValue
            if ($currentUpperValue -gt 0.01) {
                $upperFaceActiveSampleCount += 1
            }
            if (-not [string]::IsNullOrWhiteSpace($currentUpperName)) {
                if (-not $upperFaceControls.ContainsKey($currentUpperName)) {
                    $upperFaceControls[$currentUpperName] = 0
                }
                $upperFaceControls[$currentUpperName] += 1
            }
        }
        $upperValue = [double]$sample.commercialSpeechPeakUpperFaceControl
        if ($upperValue -ge $peakUpperValue) {
            $peakUpperValue = $upperValue
            $peakUpperName = [string]$sample.commercialSpeechPeakUpperFaceControlName
        }
        $mouthValue = [double]$sample.commercialSpeechPeakMouthControl
        if ($mouthValue -ge $peakMouthValue) {
            $peakMouthValue = $mouthValue
            $peakMouthName = [string]$sample.commercialSpeechPeakMouthControlName
        }
        if ($sawSpeechActive -and -not $sample.commercialSpeechActive) {
            break
        }
    } while ((Get-Date) -lt $deadline)

    $lastUpperValue = [double]$sample.commercialLastSpeechPeakUpperFaceControl
    if ($lastUpperValue -gt $peakUpperValue) {
        $peakUpperValue = $lastUpperValue
        $peakUpperName = [string]$sample.commercialLastSpeechPeakUpperFaceControlName
    }
    $lastMouthValue = [double]$sample.commercialLastSpeechPeakMouthControl
    if ($lastMouthValue -gt $peakMouthValue) {
        $peakMouthValue = $lastMouthValue
        $peakMouthName = [string]$sample.commercialLastSpeechPeakMouthControlName
    }

    $moodMatches = (
        [string]$sample.performanceMood -eq $mood -and
        [string]$sample.commercialMood -eq $mood
    )
    $intensityMatches = if ($mood -eq 'neutral') {
        [double]$sample.performanceTargetIntensity -le 0.05 -and
        [double]$sample.commercialMoodIntensity -le 0.05
    } else {
        [double]$sample.performanceTargetIntensity -ge 0.95 -and
        [double]$sample.commercialMoodIntensity -ge 0.95
    }
    $accepted = (
        $moodMatches -and
        $intensityMatches -and
        $maxAppliedBeatCount -ge 1 -and
        [int]$sample.commercialControlCount -gt 0 -and
        $peakMouthValue -gt 0.01
    )

    $dominantUpperFaceControls = @(
        $upperFaceControls.GetEnumerator() |
            Sort-Object Value -Descending |
            Select-Object -First 4 |
            ForEach-Object { "{0}:{1}" -f $_.Key, $_.Value }
    )
    $averageUpperFaceValue = if ($activeSampleCount -gt 0) {
        $upperFaceValueTotal / $activeSampleCount
    } else {
        0.0
    }
    $upperFaceActiveRatio = if ($activeSampleCount -gt 0) {
        $upperFaceActiveSampleCount / $activeSampleCount
    } else {
        0.0
    }

    $results += [pscustomobject]@{
        mood = $mood
        requestedIntensity = $intensity
        accepted = $accepted
        sawSpeechActive = $sawSpeechActive
        cueAccepted = ($cueResponse.ok -ne $false)
        speechAccepted = ($speechResponse.ok -ne $false)
        appliedMood = [string]$sample.performanceMood
        targetIntensity = [double]$sample.performanceTargetIntensity
        solverMood = [string]$sample.commercialMood
        solverIntensity = [double]$sample.commercialMoodIntensity
        maxAppliedBeatCount = $maxAppliedBeatCount
        controlCount = [int]$sample.commercialControlCount
        activeSampleCount = $activeSampleCount
        upperFaceActiveSampleCount = $upperFaceActiveSampleCount
        upperFaceActiveRatio = $upperFaceActiveRatio
        averageUpperFaceValue = $averageUpperFaceValue
        dominantUpperFaceControls = $dominantUpperFaceControls
        peakUpperFaceControl = $peakUpperName
        peakUpperFaceValue = $peakUpperValue
        peakMouthControl = $peakMouthName
        peakMouthValue = $peakMouthValue
    }
}

$health = Invoke-RestMethod -Uri "$controlUrl/health" -TimeoutSec 5
$nonNeutral = @($results | Where-Object { $_.mood -ne 'neutral' })
$responsiveUpperFace = @($nonNeutral | Where-Object { $_.peakUpperFaceValue -gt 0.01 })
$report = [pscustomobject]@{
    ok = (@($results | Where-Object { -not $_.accepted }).Count -eq 0)
    runtimeRevision = $health.runtimeRevision
    testedMoodCount = $results.Count
    upperFaceResponsiveMoodCount = $responsiveUpperFace.Count
    upperFaceDiagnosticPassed = ($responsiveUpperFace.Count -eq $nonNeutral.Count)
    results = $results
}
$report | ConvertTo-Json -Depth 8
if (-not $report.ok) {
    exit 1
}
