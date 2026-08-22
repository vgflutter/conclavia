param(
    [string] $PluginSource = 'C:\ConclaviaLipSyncLab56\RMHLipSyncDemo\Plugins\RuntimeMetaHumanLipSync\Source\RuntimeMetaHumanLipSync\Private\BlendRealisticMetaHumanLipSyncAnimNode.cpp'
)

$ErrorActionPreference = 'Stop'
$marker = 'Conclavia expression gain v33'

if (-not (Test-Path $PluginSource)) {
    throw "Runtime MetaHuman Lip Sync source not found: $PluginSource"
}

$source = Get-Content -Raw -Path $PluginSource
$usesCrLf = $source.Contains("`r`n")
$normalizedSource = $source.Replace("`r`n", "`n")
if ($normalizedSource.Contains($marker)) {
    Write-Output 'V33_EXPRESSION_GAIN_ALREADY_APPLIED'
    exit 0
}

$gainPrelude = @'
// Conclavia expression gain v33. Amplify the solver's continuous expressive
// upper-face output without touching speech articulation, blink, or gaze.
const bool bConclaviaHasAuthoredMood =
    ConclaviaExpressionSignature != 0
    || FMath::Abs(ConclaviaExpressionValence - 0.10f) > 0.08f
    || FMath::Abs(ConclaviaExpressionArousal - 0.34f) > 0.08f;
const float ConclaviaExpressionGain =
    bConclaviaSpeaking && bConclaviaHasAuthoredMood ? 1.22f : 1.0f;
auto IsConclaviaExpressiveUpperFaceControl = [](const FString& ControlName)
{
    const FString LowerName = ControlName.ToLower();
    const bool bExcluded =
        LowerName.Contains(TEXT("blink"))
        || LowerName.Contains(TEXT("look"))
        || LowerName.Contains(TEXT("gaze"))
        || LowerName.Contains(TEXT("mouth"))
        || LowerName.Contains(TEXT("lip"))
        || LowerName.Contains(TEXT("jaw"))
        || LowerName.Contains(TEXT("tongue"))
        || LowerName.Contains(TEXT("teeth"));
    const bool bExpressiveUpperFace =
        LowerName.Contains(TEXT("brow"))
        || LowerName.Contains(TEXT("cheek"))
        || LowerName.Contains(TEXT("nose"))
        || LowerName.Contains(TEXT("squint"))
        || LowerName.Contains(TEXT("widen"))
        || LowerName.Contains(TEXT("lidtight"))
        || LowerName.Contains(TEXT("eyetight"))
        || LowerName.Contains(TEXT("upperlid"))
        || LowerName.Contains(TEXT("lowerlid"));
    return bExpressiveUpperFace && !bExcluded;
};

'@

$loopComment = '// Apply the control values to the animation curves'
$curveGuard = 'if (!RuntimeLipSync_GuiToRawControlsUtils::EyesCurveNames.Find(Pair.Key))'
$legacyCurveWrite = 'Output.Curve.Set(NameUID, Pair.Value);'
$modernCurveWrite = 'Output.Curve.Set(*Pair.Key, Pair.Value);'

foreach ($needle in @($loopComment, $curveGuard, $legacyCurveWrite, $modernCurveWrite)) {
    $matches = ([regex]::Matches($normalizedSource, [regex]::Escape($needle))).Count
    if ($matches -ne 1) {
        throw "Expected exactly one commercial solver anchor '$needle', found $matches; no files were changed."
    }
}

$backup = "$PluginSource.v32-before-expression-gain"
if (-not (Test-Path $backup)) {
    Copy-Item $PluginSource $backup
}

$updated = $normalizedSource.Replace($loopComment, "$gainPrelude$loopComment")

$guardPattern = '(?m)^(?<indent>[\t ]*)if \(!RuntimeLipSync_GuiToRawControlsUtils::EyesCurveNames\.Find\(Pair\.Key\)\)\n\k<indent>\{'
$guardReplacement = @'
${indent}if (!RuntimeLipSync_GuiToRawControlsUtils::EyesCurveNames.Find(Pair.Key))
${indent}{
${indent}	const float AppliedValue = IsConclaviaExpressiveUpperFaceControl(Pair.Key)
${indent}		? FMath::Clamp(Pair.Value * ConclaviaExpressionGain, -1.0f, 1.0f)
${indent}		: Pair.Value;
'@
$updated = [regex]::Replace($updated, $guardPattern, $guardReplacement, 1)
$updated = $updated.Replace($legacyCurveWrite, 'Output.Curve.Set(NameUID, AppliedValue);')
$updated = $updated.Replace($modernCurveWrite, 'Output.Curve.Set(*Pair.Key, AppliedValue);')

if (-not $updated.Contains($marker)) {
    throw 'Expression gain marker missing after transformation.'
}
if (([regex]::Matches($updated, 'AppliedValue')).Count -ne 3) {
    throw 'Expression gain transformation was incomplete; no files were written.'
}

$serialized = if ($usesCrLf) { $updated.Replace("`n", "`r`n") } else { $updated }
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($PluginSource, $serialized, $utf8NoBom)
Write-Output 'V33_EXPRESSION_GAIN_APPLIED'
