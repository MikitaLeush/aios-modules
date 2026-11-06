# AIOS modules

Modules for [AIOS](https://github.com/MikitaLeush/aios-core). The core ships with none; take
only the ones you want. Each folder here is one module.

| Module | What it does |
|---|---|
| [modes](modes/README.md) | Focus / game / relax: closes apps, sets audio, launches PowerToys Workspaces, opens apps |
| [status](status/README.md) | The date, what's due, the weather and your calendar; full screen at `/status`. Needs **tasks** |
| [tasks](tasks/README.md) | Your task list in `tasks/tasks.md`: add, tick off and archive from the panel, Ctrl+K or voice |
| [terminal](terminal/README.md) | A shell rooted at the AIOS folder, plus Claude Code in the same window |
| [viero](viero/README.md) | Push-to-talk voice: hold a key anywhere in Windows, say a command, let go |

## Install one

In AIOS, open **Modules**, paste the repo URL with the folder after `#`, and confirm:

```
https://github.com/MikitaLeush/aios-modules.git#modes
```

AIOS shows what the module touches before installing it, installs it switched **off**, and you
turn it on. To update, remove the folder and install again.

Or by hand: copy a folder from this repo into your AIOS `modules/` folder and restart AIOS.

## License

MIT, see [LICENSE](LICENSE).
