# Status

Date and time, what's due (from `tasks/tasks.md`), the weather now + next 12 h, today's and
tomorrow's calendar, and the current mode — as a panel, and full screen at `/status` (for a TV
or second monitor; on the LAN open `/status?t=<token>`). ←/→ switch Today / Week.

Say or type: `what's due`, `weather`, `what's next`, `show today`, `show week`.

## Config (`system/machine.json` → `modules.status`)

    { "enabled": true, "lat": 52.52, "lon": 13.41, "place": "Berlin", "icsUrl": "" }

- **lat / lon** — numbers; the weather comes from Open-Meteo (free, no key, sends only these two).
- **icsUrl** — Google Calendar → Settings → your calendar → "Secret address in iCal format".
  **It is a password for your calendar**: paste it into machine.json yourself (never synced, never
  published), never into a chat. AIOS never shows, logs or sends it anywhere but Google.

Each card refreshes on its own (tasks every minute and on save, weather every 30 min, calendar
every 15 min). A card that fails keeps its last data, marked "as of HH:MM", with the reason.
