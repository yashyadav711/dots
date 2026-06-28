# ⚙️ Yash’s Dotfiles

> _Cyber-themed configs for chooms who love the terminal._

A minimal yet powerful collection of dotfiles crafted for speed, aesthetics, and modern workflows. Built for Arch-based systems, designed for **terminal-first productivity**, and themed with a **Cyberpunk** vibe.

## ✨ Quick Setup

|               Component                   |                  Description                    |
|-------------------------------------------|-------------------------------------------------|
| [🐟 **Fish Shell**](./fish/)              | Cyber-themed interactive shell config           |
| [🦾 **Alacritty Terminal**](./alacritty/) | Neon UI, Fira Code font, clipboard + opacity    |
| [🔮 **Tmux + Oh My Tmux**](./tmux/)       | Cyberpunk-themed tmux with plugin integration   |
| [🚀 **SpaceVim**](./spacevim/)            | Advanced modular Vim config for power users     |
| [🪟 **Hyprland (HyDE overlay)**](./hypr/) | `userprefs.conf` + custom scripts (run-or-raise, tmux launcher) |
| [🐱 **Kitty**](./kitty/)                  | `kitty.conf` (tab titles, key tweaks)           |
| [📦 **Packages**](./packages/)            | pacman / AUR / flatpak manifests for full reinstall |

## 🔁 Full machine restore (after a format)

This repo is built so a wiped laptop can come back **as-is**. The model: **HyDE owns the
base; this repo overlays your customizations + reinstalls every app.**

```bash
# 1. Install CachyOS/Arch + HyDE (https://github.com/HyDE-Project/HyDE)
# 2. Clone + run:
git clone https://github.com/yashyadav711/dots ~/Github/dots
bash ~/Github/dots/install.sh        # installs packages, symlinks all configs
# 3. Follow the MANUAL steps it prints (secrets, BT brain, omf, reboot)
```

`install.sh` reinstalls packages (`packages/`), symlinks fish/hypr/kitty/tmux into place
(backing up any existing real files), and clones the Oh My Tmux base.

### 🔐 Secrets policy

**No secrets in this public repo.** API keys/tokens live in `~/.config/fish/private.fish`
(auto-sourced by `config.fish`, gitignored). `.gitignore` blocks `private.fish` / `.env` /
`*.secret`. The private **BT brain** (`home-bt`) is a separate private repo — see install.sh.

## 💠 Aesthetic

- All glow.
- Neon magentas, yellows, oranges, and greens
- Nerd Fonts, semi-transparent terminals, Powerline symbols
- Best used in a dark room, at 2AM, with synthwave playing

## 🛠 Recommended Stack

- Terminal: [Alacritty](https://github.com/alacritty/alacritty)
- Shell: [Fish](https://fishshell.com/)
- Editor: [SpaceVim](https://spacevim.org)
- Multiplexer: [Tmux + Oh My Tmux](https://github.com/gpakosz/.tmux)

## 🧰 `bin/` — NHQ command scripts

`bin/nhq-*` are the NetrunnersHQ command-line tools (`nhq-status`, `nhq-spawn`, `nhq-threads`, …). They're symlinked into `~/.local/bin` on PATH. `nhq-help` (auto-discovered index) lists every one with its one-line description.

**Header convention (required for `nhq-help` to list a script):** line 2 of each script MUST be a single line in the form:

```
# nhq-<name> <args...> — <one-line description>
```

(Python scripts use `"""nhq-<name> — <desc>` on line 2 instead of `# …`.) `nhq-help` reads line 2, strips the `#`/`"""`, and keeps the text after the ` — ` em-dash as the description. A script without the em-dash still lists (it prints the whole stripped line-2) but won't be cleanly formatted. `*-selftest`, `*.bak*`, `nhq-lib.sh`, and `nhq-help` itself are excluded from the index.

When adding a new `nhq-*` script: write it here, follow the line-2 header, `chmod +x`, symlink into `~/.local/bin`. It appears in `nhq-help` automatically — no registry to touch.