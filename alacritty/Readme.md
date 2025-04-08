# 🦾 Alacritty Cyberpunk 2077 Configuration

A hyper-immersive, neon-coded **Alacritty** theme inspired by *Cyberpunk 2077*. Built for futuristic environments — sharp visuals, no distractions, and total focus.

## 📌 Features

- 🎨 Neon color palette
- 🪟 Semi-transparent window
- 🖱️ Hidden mouse on typing for full immersion
- 🧠 Auto-copy selection to clipboard
- ⌨️ F11 binds to toggle fullscreen
- 🔁 50,000-line scrollback history
- 💾 Modular theme import via `~/.config/alacritty/current_theme.toml`

## 🔧 Requirements
- [Alacritty](https://github.com/alacritty/alacritty) (GPU-accelerated terminal)
- Nerd Font (e.g., [Fira Code Nerd Font](https://www.nerdfonts.com/font-downloads)) ttf-nerd-fonts-symbols
- A compositing window manager (to support opacity)

## 📂 Directory Structure
```
~/.config/alacritty/
├── alacritty.toml               # Main configuration
├── current_theme.toml           # Symlink to the active theme
└── themes/
    └── themes/
        └── cyberpunk2077.toml   # Cyberpunk palette
```

## 🚀 Setup
```bash
# Install Alacritty
sudo pacman -S alacritty
sudo pacman -S ttf-fira-code ttf-nerd-fonts-symbols ttf-nerd-fonts-symbols-common ttf-nerd-fonts-symbols-mono
```

```bash
# Create theme config folder
mkdir -p ~/.config/alacritty/themes/themes
```

```bash
# Copy the configuration files
cp alacritty.toml ~/.config/alacritty/alacritty.toml
cp cyberpunk2077.toml ~/.config/alacritty/themes/themes/cyberpunk2077.toml
ln -s ~/.config/alacritty/themes/themes/cyberpunk2077.toml ~/.config/alacritty/current_theme.toml
```

## 🎨 Theme Highlights
|   Element     |    Color     | Hex Code   |
|---------------|--------------|------------|
| Background    | Dark Black   | `#0f0f17`  |
| Foreground    | Neon White   | `#fffcf2`  |
| Cursor        | Magenta      | `#ff007f`  |
| Red           | Cyber Red    | `#ff003c`  |
| Green         | Hacker Green | `#00ff99`  |
| Yellow        | Electric     | `#ffcc00`  |
| Magenta       | Glowing Pink | `#ff22ff`  |
| Orange        | Bright Orange| `#ff8800`  |

## 🧠 UX Enhancements
- `selection.save_to_clipboard = true` — no Ctrl+C needed
- `mouse.hide_when_typing = true` — cursor vanishes during input
- `cursor.style = "Block"` + `thickness = 0.2` — glowing classic look
- `scrolling.history = 50_000` — never lose context

## 🔐 Notes
- This theme is optimized for dark backgrounds.
- Designed for punks who loves their terminal and want a UI that feels like a control deck.
- Alacritty has migrated to alacritty.toml (v0.12+); if upgrading use **alacritty migrate**.