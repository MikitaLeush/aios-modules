# Tasks

Your task list in `tasks/tasks.md`: add, tick off and archive tasks from the panel, Ctrl+K or
voice. On by default. Archived tasks move to `tasks/done.md` with the date.

Say or type: `add task <text>` (also `new task …`, `remind me to …`), `archive tasks`.

## The line format

One task per line:

    - [ ] Send the invoice !p1 @2026-11-02 #work

`!p1`/`!p2`/`!p3` priority, `@YYYY-MM-DD` due date, `#tag` — all optional. `- [x]` is done.
`- [] text` and `* [ ] text` are **not** tasks: the panel lists them as unread lines so they
never disappear silently.

Type the markers into the panel's input and they are kept. A spoken or Ctrl+K `add task …`
is lowercased, loses punctuation and keeps at most 8 words, so markers only work from the panel.

## How it behaves

- Every write is atomic and, when `git` is installed, lands in the undo history
  (`.aios-history/`, see `core/vault.js`).
- Ticking a task sends the line it showed; if the file changed in the meantime (an editor,
  sync from another computer), nothing is written and the panel refreshes.
- Edits made outside AIOS show up within a second (the folder is watched).

`AIOS_TASKS_DIR` (environment only, relative to the vault root) points the module at another
folder — a test hook for the demo preview.
