$ErrorActionPreference = "Stop"

Import-Module AudioDeviceCmdlets
$line = Get-AudioDevice -List |
    Where-Object {
        $_.Type -eq "Playback" -and
        $_.Name -like "CABLE Input (VB-Audio Virtual Cable*"
    } |
    Select-Object -First 1
if ($null -eq $line) {
    throw "VB-Audio CABLE Input render endpoint not found."
}
Set-AudioDevice -ID $line.ID | Out-Null

Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.Rate = 2
for ($index = 0; $index -lt 14; $index += 1) {
    $voice.Speak(
        "Paola parla chiaramente: mamma, babbo, pane, pepe, vino. " +
        "Ora la bocca deve aprirsi e chiudersi in modo evidente."
    )
}
$voice.Dispose()
