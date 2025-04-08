# 💾 Visual Studio Code – Cyberpunk Edition

A futuristic and productivity-boosted `settings.json` for **Visual Studio Code**, tailored with cyberpunk aesthetics, developer-centric UX tweaks, and live integrations.

## 🚀 Features

- 🎨 **Cyberpunk2077 Theme** with custom neon syntax
- 🧩 **Prettier** formatter bound to HTML, JS, and CSS
- ✨ **Neon Cursor & Terminal Styling**
- ⛓️ **Fira Code Nerd Font** with ligatures and symbols
- 🧠 **Smart Git UX** with no sync confirmations
- 📰 **Marquee widget feeds** for news, weather, npm stats
- 🛠️ **Minimap off**, **sidebar right**, **whitespace visuals**
- 🔍 **Custom TextMate scopes** for bold, colored semantics
- 💬 **Live Server optimized** (no tag verification popups)

## 🔧 Requirements

- [Visual Studio Code](https://code.visualstudio.com/)
- [Prettier Extension](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [Catppuccin Macchiato Icons](https://marketplace.visualstudio.com/items?itemName=Catppuccin.catppuccin-vsc-icons)
- [Cyberpunk2077 Theme](https://marketplace.visualstudio.com/items?itemName=gerane.Theme-Cyberpunk2077)
- [Marquee Extension](https://marketplace.visualstudio.com/items?itemName=antfu.marquee)
- Fira Code + Symbols Nerd Font (`ttf-fira-code`, `ttf-nerd-fonts-symbols`)

## 📂 Location

```bash
~/.config/Code/User/settings.json
```

## 🎨 Syntax Highlighting

| Element     | Color        | Hex      |
|-------------|--------------|----------|
| Comments    | Muted Gray   | `#757575` |
| Strings     | Neon Green   | `#00FF99` |
| Keywords    | Cyber Yellow | `#FFD700` |
| Functions   | Red-Orange   | `#FF3300` |
| Variables   | Deep Orange  | `#FF4500` |
| Numbers     | Bright Yellow| `#FFDD00` |
| Types       | Cyan         | `#00FFFF` |

> Terminal cursor: **Magenta** `#FF00FF`  
> Editor cursor: **Cyan** `#00FFFF`

## 🎯 UX Enhancements

- `"editor.minimap.enabled": false` — declutters the view
- `"editor.renderWhitespace": "boundary"` — keeps indentation in check
- `"editor.cursorBlinking": "phase"` — neon animation style
- `"editor.cursorSmoothCaretAnimation": "on"` — buttery cursor movement
- `"editor.fontLigatures": true` — Fira Code magic
- `"editor.lineHeight": 0` + `"editor.fontSize": 15` — compact, readable layout
- `"terminal.integrated.fontSize": 14` — consistent visual feel

## 🌐 Marquee Widget Feeds

Includes security news, developer insights, and weather:

- **Tech**: HN Frontpage, HN Best, Dev.to, Smashing Magazine
- **Security**: BleepingComputer, Dark Reading, Security Week

## 🧪 Git Behavior

- `"git.confirmSync": false`
- `"git.openRepositoryInParentFolders": "never"`
- `"git.enableSmartCommit": true`

Designed to avoid modal interruptions during rapid workflows.

## 🧠 Notes

- Compatible with [Codeium](https://codeium.com/) via `"codeium.enableConfig"` toggle.
- Built for maximum immersion, minimal distraction.
- Requires patched Nerd Fonts to render Powerline + glyphs correctly.
- Syntax theme applies via `editor.tokenColorCustomizations` and `textMateRules`.