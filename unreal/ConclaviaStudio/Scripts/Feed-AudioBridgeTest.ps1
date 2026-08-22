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

# Start early and keep feeding samples throughout Unreal's variable warm/cold
# initialization window. The first cached launch can reach subject creation in
# under twenty seconds, while a cold shader/module load can take much longer.
Start-Sleep -Seconds 2
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.Rate = 2
while ($true) {
    $voice.Speak(
        "Conclavia prova il collegamento audio dal vivo. " +
        "Questa frase alimenta il movimento del volto in tempo reale."
    )
}
