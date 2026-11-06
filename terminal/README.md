# Terminal

A shell rooted at the vault and Claude Code in the same window. Type a command and it runs in the
vault folder; `cd` sticks and the prompt shows where you are. Type `claude` to talk to Claude, or
`claude <question>` to ask once. Type `help` for everything else. On by default.

Say or type `ask claude <question>` (Ctrl+K or Viero) and the question appears in the Terminal as if
you had typed it, with `(voice)` in front when you spoke it. The full answer is always in the
Terminal; only a short version is spoken.

The terminal is **loopback only**: it answers nothing from another device on your network. Full-screen
programs (vim, top, interactive `claude`) need a real TTY: use the **Open OS terminal** button.

## Setup (all optional)

In `system/machine.json` → `modules.terminal`:

| Key | What |
|---|---|
| `shell` | Shell to use. Empty = automatic (pwsh, then powershell, then cmd on Windows; bash, zsh, sh elsewhere) |
| `claudeBin` | Full path to the Claude Code executable, if AIOS cannot find it |
| `model` | Model for Claude replies, passed as `--model` |
| `flags` | Extra Claude Code flags, as a list of strings |

## What Claude may do here

- It can **read** anything in the vault.
- It can **edit and write files only inside `projects/`**.
- It gets **no shell commands, no web and no MCP tools**.

`flags` are added after these rules, so they can add flags but never remove the denies. A
`--permission-mode` in `flags` replaces the default mode.

## Legacy dashboard

The old dashboard at `/legacy` keeps its own top-level `terminalShell`, `claudeBin` and
`claudeChatFlags` in `system/machine.json` until legacy is deleted. They do not affect this module,
and the keys above do not affect legacy.

## Test and demo only

`AIOS_TERMINAL_FAKE_CLAUDE=<vault-relative path>` swaps the Claude CLI for a stand-in script (see
`test/fake-claude.js`; `FAKE_CLAUDE_MODE` picks its behaviour: ok, slow, fail, ...). It is read once
at start and is used by the `aios-terminal-demo` preview. Do not set it on a real machine.
