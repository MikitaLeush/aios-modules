# Synthetic 16 kHz mono command clips (built-in Windows voice) for listener tests and bench.js.
# Synthetic speech is cleaner than a real mic: treat results as a best case.
# Usage: powershell -File make-clips.ps1 -Out <dir> [-Phrases "game mode;open spotify"]
param(
  [string]$Out = (Join-Path $env:TEMP 'aios-viero-clips'),
  [string]$Phrases = 'focus mode;game mode;relax mode;switch to game;switch to focus;game mode please;game mode on;open spotify;open music;open discord;open steam;open obsidian;open notes;close discord;close steam;close obsidian;volume 40;volume 20;set volume to 60;volume to 80'
)
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$list = $Phrases.Split(';') | Where-Object { $_.Trim() }
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$lines = @()
for ($i = 0; $i -lt $list.Count; $i++) {
  $f = Join-Path $Out ('clip{0:D2}.wav' -f $i)
  $s.SetOutputToWaveFile($f, $fmt); $s.Speak($list[$i].Trim()); $s.SetOutputToNull()
  $lines += ("{0}`t{1}" -f (Split-Path $f -Leaf), $list[$i].Trim())
}
$lines | Set-Content -Encoding utf8 (Join-Path $Out 'expected.tsv')
"wrote $($list.Count) clips to $Out"
