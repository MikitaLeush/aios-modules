# Modes module

Focus / game / relax. A switch runs its steps in a fixed order — **close → audio → workspace → open** —
and reports each one. Apps are closed like clicking X (`taskkill` without `/f`); an app still running
after 5 s is reported, never forced. Tray apps (Discord, Steam) usually hide instead of exiting.

Commands (Ctrl+K, panel, voice): `game mode`, `switch to game`, `open music`, `close discord`, `volume 40`.

## Config

Per machine, in `system/machine.json` → `modules.modes`. Restart AIOS (or turn Modes off and on)
after changing `dryRun`; everything else is read on each switch.

```json
{
  "enabled": true,
  "dryRun": false,
  "apps": {
    "spotify": { "launch": "spotify:", "process": "Spotify.exe", "aliases": ["music"] },
    "steam":   { "launch": "steam://open/main", "process": "steam.exe" }
  },
  "modes": {
    "game":  { "close": ["spotify"], "audio": { "output": "Headphones", "volume": 50 }, "open": ["steam"] },
    "relax": { "workspace": "Chill", "audio": { "volume": 25 }, "open": ["spotify"] }
  }
}
```

- **apps** — names are lowercase `a-z 0-9 -`. `launch` is an `.exe` path, a URI, or a shortcut;
  `process` is the image name from `tasklist` (needed to close); `aliases` are other names you say.
- **modes** — `close` / `open` list app names. `audio.output` matches part of a playback device name
  (needs the AudioDeviceCmdlets PowerShell module); `audio.volume` is 0-100. `workspace` is a
  PowerToys Workspace name.
- **dryRun** — steps are recorded, nothing on the computer changes.

Problems in the config (unknown app, bad process name, app with nothing to close or launch) are
listed at the top of the Modes panel.
