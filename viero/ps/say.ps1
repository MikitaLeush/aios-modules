# AIOS Viero: say one line with the built-in Windows voice (System.Speech).
# The text arrives as a parameter, never as script text.
param([string]$Text = '')
if (-not $Text) { exit 0 }
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = 1
$s.Speak($Text)
