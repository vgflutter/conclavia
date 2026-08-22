param(
    [string] $PluginSource = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\Plugins\RuntimeMetaHumanLipSync\Source\RuntimeMetaHumanLipSync\Private\BlendRealisticMetaHumanLipSyncAnimNode.cpp'
)

$ErrorActionPreference = 'Stop'
$oldMarker = 'Conclavia expression gain v33'
$newMarker = 'Conclavia expression gain v34'
$oldGain = 'bConclaviaSpeaking && bConclaviaHasAuthoredMood ? 1.22f : 1.0f;'
$newGain = 'bConclaviaSpeaking && bConclaviaHasAuthoredMood ? 1.35f : 1.0f;'

if (-not (Test-Path $PluginSource)) {
    throw "Runtime MetaHuman Lip Sync source not found: $PluginSource"
}

$source = Get-Content -Raw -Path $PluginSource
if ($source.Contains($newMarker)) {
    if (-not $source.Contains($newGain)) {
        throw 'The v34 marker exists but the expected 1.35 gain is missing.'
    }
    Write-Output 'V34_EXPRESSION_GAIN_ALREADY_APPLIED'
    exit 0
}

foreach ($needle in @($oldMarker, $oldGain)) {
    $matches = ([regex]::Matches($source, [regex]::Escape($needle))).Count
    if ($matches -ne 1) {
        throw "Expected exactly one v33 expression-gain anchor '$needle', found $matches; no files were changed."
    }
}

$backup = "$PluginSource.v33-before-expression-gain-1.35"
if (-not (Test-Path $backup)) {
    Copy-Item $PluginSource $backup
}

$updated = $source.Replace($oldMarker, $newMarker).Replace($oldGain, $newGain)
if (-not $updated.Contains($newMarker) -or -not $updated.Contains($newGain)) {
    throw 'Expression gain v34 transformation was incomplete; no files were written.'
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($PluginSource, $updated, $utf8NoBom)
Write-Output 'V34_EXPRESSION_GAIN_APPLIED'
