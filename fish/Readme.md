# 🐟 Fish Shell Configuration

A streamlined, cyber-themed Fish shell configuration for high-efficiency terminal workflows.

## 📌 Features
- 💡 Smart interactive setup (loads only in interactive sessions)
- 🎨 Cyberpunk-inspired color scheme (customized `fish_color_*`)
- 🛠 Modular design (separates aliases, git functions, secrets)
- ⚡ Shell enhancements:
  - `fzf` integration for directory traversal
  - `bat` for pretty manpages and `cat`
  - `atuin` and `thefuck` for history + correction
- 🎯 Arch/ArcoLinux-specific optimizations

## 🔧 Requirements

- Fish Shell ≥ 3.6
- [fzf](https://github.com/jethrokuan/fzf)
- [bat](https://github.com/sharkdp/bat)
- [atuin](https://github.com/ellie/atuin)
- [thefuck](https://github.com/nvbn/thefuck)
- [Oh My Fish](https://github.com/oh-my-fish/oh-my-fish)
- [Tide](https://github.com/IlanCosman/tide)

## 📂 Directory Structure

```
~/.config/fish/
├── config.fish         # Main configuration
├── alias.fish          # Aliases (sourced modularly)
```

## 🚀 Setup

```bash
# Ensure Fish is installed
sudo pacman -S fish          # Arch / Manjaro
```

```fish
# Install required dependencies
sudo pacman -S bat eza fzf thefuck atuin direnv pacman-contrib expac reflector wf-recorder yt-dlp
yay -S paru-bin
```

```fish
# Set fish as your default shell if not already
chsh -s /usr/bin/fish
```

```fish
# Copy config and alias files to fish configuration directory
cp config.fish alias.fish ~/.config/fish/
```

```fish
# Install Oh My Fish and various plugins
curl https://raw.githubusercontent.com/oh-my-fish/oh-my-fish/master/bin/install | fish
omf install fish-spec foreign-env git nvm peco
```

## 🔧 Notable Functions

```fish
reload           # Restart current shell session
```

## 🎨 Theme Preview

This config uses a neon-inspired cyber color palette:
- Commands → `#ffcc00`
- Parameters → `#00ffee`
- Errors → `#ff003c`
- Paths → Underlined
- User Prompt → `#00ff99`

Best viewed with **dark terminals and Nerd Fonts**.

## 🔐 Notes

- Assumes Arch-based package managers (Pacman, Paru, Yay).