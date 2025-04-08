# 🚀 Enhanced SpaceVim Configuration

A modern, minimal, and developer-centric SpaceVim setup — focused on usability, aesthetics, and productivity. This configuration enhances the default SpaceVim experience with autocompletion, Git tools, fuzzy finding, integrated terminal, syntax checking, and more.

## 📦 Features
- 🎨 **Dracula theme** with Nerd Font support  
- ⚡ **fzf-based navigation** and fuzzy file switching  
- 🧠 **Autocomplete** with tab cycling  
- 🔧 **Auto-formatting on save**  
- 🧩 **Git integration** via Fugitive and Gutter  
- 🪄 **Syntax checking** and Tagbar-based code navigation  
- 🖥️ **Integrated terminal** with scrollbars and minimal clutter  

## 🛠 Installation

1. **Install SpaceVim**:
   ```bash
   curl -sLf https://spacevim.org/install.sh | bash
   ```

2. **Copy the config**:
   ```bash
   cp init.toml ~/.config/SpaceVim.d/init.toml
   ```

3. **Launch SpaceVim**:
   ```bash
   vim
   ```

## ❌ Uninstallation
To remove SpaceVim cleanly:

### 1. Run the uninstall script:
```bash
curl -sLf https://spacevim.org/install.sh | bash -s -- -u
```


### 2. Manually remove remaining files:
```bash
rm -rf ~/.config/SpaceVim.d
rm -rf ~/.local/share/SpaceVim
rm -rf ~/.cache/SpaceVim
```

> ⚠️ Warning: This will delete your SpaceVim config and all downloaded plugins and cache.

## 📁 File Location
- User configuration: `~/.config/SpaceVim.d/init.toml`

## 🧠 Notes
- Requires `Fira Code Nerd Font` for full icon support.