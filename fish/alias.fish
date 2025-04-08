# Navigate quickly to temporary work directory
alias tmp="cd ~/Documents/tmp"

# Display Btrfs filesystem usage in a human-readable format
alias btrfsfs="sudo btrfs filesystem df /"

# Clear terminal screen
alias cls="clear"

# Human-readable disk usage overview
alias df="df -h"

# Show memory usage including totals
alias free="free -mt"

# Force-remove Pamac DB lock (resolves stuck package manager state)
alias pamac-unlock="sudo rm /var/tmp/pamac/dbs/db.lock"

# Print working directory (custom spelling for convenience)
alias pdw="pwd"

# Force-remove ArcoLinux logout lockfile
alias rmlogoutlock="sudo rm /tmp/arcologout.lock"

# Resume partially downloaded files via wget
alias wget="wget -c"

# Show current audio server info (PulseAudio or PipeWire)
alias audio="pactl info | grep 'Server Name'"

# Identify CPU microarchitecture
alias cpu="cpuid -i | grep uarch | head -n 1"

# Colored grep variants
alias egrep="grep -E --color=auto"
alias fgrep="grep -F --color=auto"
alias grep="grep --color=auto"

# Check BIOS info and board vendor via lshw
alias howold="sudo lshw | grep -B 3 -A 8 BIOS"

# List hidden files only
alias l.="ls -A | grep -E '^\.'"

# Inspect CPU microcode vulnerability exposure
alias microcode="grep . /sys/devices/system/cpu/vulnerabilities/*"

# Grep active processes with visual filter
alias psgrep="ps aux | grep -v grep | grep -i -e VSZ -e"

# Summarize hardware via hwinfo
alias hw="hwinfo --short"

# List installed kernel modules (duplicate aliases for preference)
alias kernel="ls /usr/lib/modules"
alias kernels="ls /usr/lib/modules"

# Upload anonymized hardware profile
alias probe="sudo -E hw-probe -all -upload"

# Display failed systemd units
alias sysfailed="systemctl list-units --failed"

# YouTube audio extraction aliases with specific formats
alias yta-aac="yt-dlp --extract-audio --audio-format aac"
alias yta-best="yt-dlp --extract-audio --audio-format best"
alias yta-flac="yt-dlp --extract-audio --audio-format flac"
alias yta-mp3="yt-dlp --extract-audio --audio-format mp3"

# Download best video+audio from YouTube in MP4 format
alias ytv-best="yt-dlp -f 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio' --merge-output-format mp4"

# Enhanced replacements for core tools (bat for cat, exa for ls)
alias cat="bat --paging=never --style=plain --color=always"
alias la="exa -laghH@ --icons --color=always --group-directories-first --time-style=long-iso --total-size"
alias ll="exa -lghHi --icons --color=always --group-directories-first --time-style=long-iso"
alias ls="exa --icons --color=always --group-directories-first"

# ArcoLinux convenience aliases
alias atm="arcolinux-tellme"
alias bls="betterlockscreen -u /usr/share/backgrounds/arcolinux/"
alias downgrada="sudo downgrade --ala-url https://ant.seedhost.eu/arcolinux/"
alias install-grub-efi="sudo grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=ArcoLinux"

# Kill common UI components
alias kc="killall conky"
alias kp="killall polybar"
alias kpi="killall picom"

# View Calamares installer logs
alias lcalamares="bat /var/log/Calamares.log"

# Manage LeftWM themes
alias lti="leftwm-theme install"
alias ltu="leftwm-theme uninstall"

# Refresh mirror list using different reflector strategies
alias mirrora="sudo reflector --latest 30 --number 10 --sort age --save /etc/pacman.d/mirrorlist"
alias mirrord="sudo reflector --latest 30 --number 10 --sort delay --save /etc/pacman.d/mirrorlist"
alias mirrors="sudo reflector --latest 30 --number 10 --sort score --save /etc/pacman.d/mirrorlist"
alias mirrorx="sudo reflector --age 6 --latest 20  --fastest 20 --threads 5 --sort rate --protocol https --save /etc/pacman.d/mirrorlist"
alias mirrorxx="sudo reflector --age 6 --latest 20  --fastest 20 --threads 20 --sort rate --protocol https --save /etc/pacman.d/mirrorlist"

# Quick access to common config files and log editors
alias nalacritty="$EDITOR /home/$USER/.config/alacritty/alacritty.toml"
alias pacinstall='sudo pacman -S'
alias paruinstall='paru -S'
alias paruskip="paru -S --mflags --skipinteg"
alias yayinstall='yay -S'
alias yayskip="yay -S --mflags --skipinteg"

# Pacman lock, update, and mirror maintenance
alias cleanup="sudo pacman -Rns (pacman -Qtdq)"
alias rmpacmanlock="sudo rm /var/lib/pacman/db.lck"
alias unlock="sudo rm /var/lib/pacman/db.lck"
alias upa="paru -Syu --noconfirm"
alias upd="sudo pacman -Syyu"
alias update="sudo pacman -Syyu"

# GPG, grub, pacman config and permission recovery
alias fix-key="/usr/local/bin/arcolinux-fix-pacman-databases-and-keys"
alias fixkeys="/usr/local/bin/arcolinux-fix-pacman-databases-and-keys"
alias fix-permissions="sudo chown -R $USER:$USER ~/.config ~/.local"
alias fixkey="/usr/local/bin/arcolinux-fix-pacman-databases-and-keys"
alias grub-update="sudo grub-mkconfig -o /boot/grub/grub.cfg"
alias update-grub="sudo grub-mkconfig -o /boot/grub/grub.cfg"
alias fixgrub="sudo /usr/local/bin/arcolinux-fix-grub"

# Snapshot and backup utilities
alias snapchome="sudo snapper -c home create-config /home"
alias snapcroot="sudo snapper -c root create-config /"
alias snapch="sudo snapper -c home create"
alias snapcr="sudo snapper -c root create"
alias snapli="sudo snapper list"

# Recording with Wayland tools
alias wsimplescreen="wf-recorder -a"
alias wsimplescreenrecorder="wf-recorder -a -c h264_vaapi -C aac -d /dev/dri/renderD128 --file=recording.mp4"

# Miscellaneous utilities
alias jctl="journalctl -p 3 -xb"   # View critical system logs
alias undopush="git push -f origin HEAD^:master"  # Force-push previous commit

# Refresh mirrorlist using rate-mirrors (alternative to reflector)
alias ram="rate-mirrors --allow-root --disable-comments arch | sudo tee /etc/pacman.d/mirrorlist"
alias rams="rate-mirrors --allow-root --disable-comments --protocol https arch | sudo tee /etc/pacman.d/mirrorlist"

# Open Calamares installer logs in Sublime Text
alias scal="subl /var/log/Calamares.log"

# Set system locale to US English
alias setlocale="sudo localectl set-locale LANG=en_US.UTF-8"
alias setlocales="sudo localectl set-x11-keymap be && sudo localectl set-locale LANG=en_US.UTF-8"

# Start and enable VMware services
alias start-vmware="sudo systemctl enable --now vmtoolsd.service"
alias sv="sudo systemctl enable --now vmtoolsd.service"
alias vmware-start="sudo systemctl enable --now vmtoolsd.service"

# List available X and Wayland sessions
alias xd="ls /usr/share/xsessions"
alias xdw="ls /usr/share/wayland-sessions"

# Package list queries
alias list="sudo pacman -Qqe"          # List all explicitly installed packages
alias listaur="sudo pacman -Qqem"      # List all AUR packages
alias listt="sudo pacman -Qqet"        # List explicitly installed non-AUR packages

# Show pacman logs with syntax highlighting
alias lpacman="bat /var/log/pacman.log"

# LeftWM theme operations
alias ltupd="leftwm-theme update"
alias lta="leftwm-theme apply"
alias ltupg="leftwm-theme upgrade"

# Reflector with verbose and fast mirrorlist output
alias mirror="sudo reflector -f 30 -l 30 --number 10 --verbose --save /etc/pacman.d/mirrorlist"

# Quick edit of mirrorlist and pacman-related configuration files
alias narcomirrorlist="sudo $EDITOR /etc/pacman.d/arcolinux-mirrorlist"
alias ngnupgconf="sudo $EDITOR /etc/pacman.d/gnupg/gpg.conf"
alias nmirrorlist="sudo $EDITOR /etc/pacman.d/mirrorlist"
alias npacman="sudo $EDITOR /etc/pacman.conf"

# Search packages in repo/AUR
alias pacsearch='sudo pacman -Ss'
alias parusearch='paru -Ss'
alias yaysearch='yay -Ss'

# Update all packages using paru or yay
alias pksyua="paru -Syu --noconfirm"

# Open pacman config in Sublime Text
alias spac="subl /etc/pacman.conf"

# Various pacman helper operations
alias spqo='sudo pacman -Qo'       # Find owner of a file
alias sprdd='sudo pacman -Rdd'     # Remove without checking dependencies
alias sprs='sudo pacman -Rs'       # Remove with dependencies
alias spsii='sudo pacman -Sii'     # Show detailed package info

# Display manager install and activation helpers
alias toemptty="sudo pacman -S emptty --noconfirm --needed ; sudo systemctl enable emptty.service -f ; echo 'Emptty is active - reboot now'"
alias togdm="sudo pacman -S gdm --noconfirm --needed ; sudo systemctl enable gdm.service -f ; echo 'Gdm is active - reboot now'"
alias tolightdm="sudo pacman -S lightdm lightdm-gtk-greeter lightdm-gtk-greeter-settings --noconfirm --needed ; sudo systemctl enable lightdm.service -f ; echo 'Lightm is active - reboot now'"
alias tolxdm="sudo pacman -S lxdm --noconfirm --needed ; sudo systemctl enable lxdm.service -f ; echo 'Lxdm is active - reboot now'"
alias toly="sudo pacman -S ly --noconfirm --needed ; sudo systemctl enable ly.service -f ; echo 'Ly is active - reboot now'"
alias tosddm="sudo pacman -S sddm --noconfirm --needed ; sudo systemctl enable sddm.service -f ; echo 'Sddm is active - reboot now'"

# Fix broken GPG operations
alias fix-gpg-check="gpg2 --keyserver-options auto-key-retrieve --verify"
alias fix-gpg-retrieve="gpg2 --keyserver-options auto-key-retrieve --receive-keys"

# Fix and rebuild ArcoLinux GRUB setup
alias fix-grub="sudo /usr/local/bin/arcolinux-fix-grub"
alias fixgrub="sudo /usr/local/bin/arcolinux-fix-grub"

# Additional ArcoLinux support tools
alias agm="arcolinux-get-mirrors"
alias amr="arcolinux-mirrorlist-rank-info"
alias aom="arcolinux-osbeck-as-mirror"
alias toboot="sudo /usr/local/bin/arcolinux-toboot"
alias togrub="sudo /usr/local/bin/arcolinux-togrub"

# Edit bootloader/grub config
alias nconfgrub="sudo $EDITOR /boot/grub/grub.cfg"
alias ngrub="sudo $EDITOR /etc/default/grub"

# Edit display manager configs
alias nlxdm="sudo $EDITOR /etc/lxdm/lxdm.conf"
alias nlightdm="sudo $EDITOR /etc/lightdm/lightdm.conf"
alias nsddm="sudo $EDITOR /etc/sddm.conf"
alias nsddmd="sudo $EDITOR /usr/lib/sddm/sddm.conf.d/default.conf"
alias nsddmk="sudo $EDITOR /etc/sddm.conf.d/kde_settings.conf"

# Edit core system configuration files
alias nfstab="sudo $EDITOR /etc/fstab"
alias nhosts="sudo $EDITOR /etc/hosts"
alias nrefind="sudo $EDITOR /boot/refind_linux.conf"
alias nvconsole="sudo $EDITOR /etc/vconsole.conf"
alias nenvironment="sudo $EDITOR /etc/environment"
alias nhostname="sudo $EDITOR /etc/hostname"

# Restore fish config from skeleton
alias cf="cp /etc/skel/.config/fish/config.fish ~/.config/fish/config.fish && exec fish"

# Quick access to major shell config files
alias nb="$EDITOR ~/.bashrc"
alias nz="$EDITOR ~/.zshrc"
alias nf="$EDITOR ~/.config/fish/config.fish"
alias nneofetch="$EDITOR ~/.config/neofetch/config.conf"
alias nfastfetch="$EDITOR ~/.config/fastfetch/config.jsonc"

# Quick edit boot/loader/system files
alias nloader="sudo $EDITOR /boot/efi/loader/loader.conf"
alias nmakepkg="sudo $EDITOR /etc/makepkg.conf"
alias nmkinitcpio="sudo $EDITOR /etc/mkinitcpio.conf"
alias nnsswitch="sudo $EDITOR /etc/nsswitch.conf"
alias nplymouth="sudo $EDITOR /etc/plymouth/plymouthd.conf"
alias nresolv="sudo $EDITOR /etc/resolv.conf"
alias nsamba="sudo $EDITOR /etc/samba/smb.conf"

# Snapper snapshot helpers
alias snapli="sudo snapper list"

# Btrfs subvolume list
alias btrfsli="sudo btrfs su li / -t"

# Display user list
alias userlist="cut -d: -f1 /etc/passwd | sort"

# Git & package log utilities
alias depends='function_depends'  # Custom function reference (define externally)
alias big="expac -H M \"%m\t%n\" | sort -h | nl"  # List biggest packages by size
alias bupskel="cp -Rf /etc/skel ~/.skel-backup-(date +%Y.%m.%d-%H.%M.%S)"  # Backup default configs
alias cb="cp /etc/skel/.bashrc ~/.bashrc && echo \"Copied.\""
alias cz="cp /etc/skel/.zshrc ~/.zshrc && echo \"Copied.\""

# Misc UX utilities
alias ff="fastfetch"            # System info fetcher
alias ip="ip -color"            # Colored IP output
alias iso="cat /etc/dev-rel | awk -F '=' '/ISO/ {print $2}'"
alias isoo="cat /etc/dev-rel"
alias merge="xrdb -merge ~/.Xresources"

# Process monitoring, sorting, reboot/shutdown
alias psa="ps auxf"
alias rg="rg --sort path"       # Ripgrep sorted by path
alias rip="expac --timefmt='%Y-%m-%d %T' '%l\t%n %v' | sort | tail -200 | nl"
alias riplong="expac --timefmt='%Y-%m-%d %T' '%l\t%n %v' | sort | tail -3000 | nl"
alias sr="reboot"
alias ssn="sudo shutdown now"

# Disable all hblock DNS blocking rules
alias unhblock="hblock -S none -D none"
