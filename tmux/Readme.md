# 🔮 Oh My Tmux – Cyberpunk Edition

A high-contrast, neon-infused `.tmux.conf.local` built on top of [gpakosz/.tmux](https://github.com/gpakosz/.tmux) — delivering a futuristic terminal multiplexing experience.

## 🚀 Features
- 🎨 **Cyberpunk 2077 theme** — bold neon palette, styled indicators, glowing status bars  
- ⚡ **Performance-oriented** — lean defaults, mouse mode on, Vi keybindings, large scrollback buffer  
- 🔗 **Plugin support** — pre-integrated TPM plugins like `tmux-notify`, `tmux-cht-sh`, and `tmux-copycat` all thanks to [gpakosz](https://github.com/gpakosz/)
- 📊 **Visual battery, uptime, and user indicators** with Powerline symbols  
- 🧠 **Smart window/pane handling** — retains paths, supports 24-bit RGB, SSH-aware sessions  
- 📋 **Clipboard integration** — copy mode syncs with system clipboard

## 📦 Prerequisites
- `tmux` ≥ 3.2
- `xclip` or `xsel` and `acpi` (for Linux clipboard and battery support)

  ```bash
  sudo pacman -S xclip xsel acpi
  ```
- Powerline-patched font (e.g., FiraCode Nerd Font, awesome-terminal-fonts)

## 🧰 Installation
```bash
# Clone the Oh My Tmux repo
cd
git clone --single-branch https://github.com/gpakosz/.tmux.git

# Symlink the main config file
ln -s -f .tmux/.tmux.conf

# Copy this custom cyberpunk config as your local override
cp .tmux/.tmux.conf.local ~/.tmux.conf.local
```

Now to update the theme to Cyberpunk 2077 theme:
  ```bash
  # Just replace ~/.tmux.conf.local with my .tmux.conf.local
  cp path/to/my/.tmux.conf.local ~/.tmux.conf.local
  ```

## 🎮 Some Key Bindings
**Prefix** is `CTRL + B`
- `prefix + r` → reload tmux
- `prefix + %` → split vertically
- `prefix + "` → split horizontally
- `prefix + u` → update plugins
- `prefix + S` → launch `tmux-cht-sh` for instant cheat sheets
- `prefix + t` → stylish clock popup

Click [here](https://github.com/gpakosz/.tmux?tab=readme-ov-file#bindings) for more Key Bindings.

## 🎨 Theme Highlights
| Component          | Color                         |
|--------------------|-------------------------------|
| Background         | `#0D0D0D` (Cyber Black)        |
| Active Pane Border | `#FF073A` (Neon Red)           |
| Status Left        | Cyan → Green → Magenta glow   |
| Status Right       | Gold → Cyan → Pink → Purple   |
| Cursor             | `#FF007F` (Magenta Block)      |

✅ Powerline symbols and Nerd Font icons fully supported.

## 🧩 Included TPM Plugins
- [`tmux-notify`](https://github.com/rickstaa/tmux-notify)
- [`tmux-cht-sh`](https://github.com/kenos1/tmux-cht-sh)
- [`tmux-copycat`](https://github.com/tmux-plugins/tmux-copycat)

_To extend further, simply edit your `~/.tmux.conf.local` and add `set -g @plugin '...'` lines._

## ⚙️ Customization Notes
- **Status bar uptime** uses `#{uptime_*}` segments for real-time stats  
- **Battery display** uses bar + icons (`🔋`, `🔌`) with color-coded thresholds  
- **System clipboard** sync enabled by default  
- **Window alerts** styled with 🔔 and 🔍 icons  