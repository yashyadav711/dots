---------------------------------------------------------------------------
-- luakit theme — NHQ dark (ember on coal)
--
-- Colours are lifted from the omp terminal theme (~/.omp/agent/themes/nhq.json)
-- rather than invented, so the browser and the terminal look like one machine:
--   coal #121419  bg        ember #e8734a  accent
--   ash  #d4d8e4  fg        soot  #6b7280  dimmed
--
-- Every key the shipped /etc/xdg/luakit/theme.lua defines is defined here too.
-- A missing key is not a fallback — widgets read theme values directly and an
-- absent one surfaces as an error or an unstyled bar, so this file stays complete
-- rather than "only the ones I wanted to change".
---------------------------------------------------------------------------

local theme = {}

-- Default settings
theme.font = "11px JetBrains Mono, monospace"
theme.fg   = "#d4d8e4"
theme.bg   = "#121419"

-- General colours
theme.success_fg = "#7fb069"
theme.loaded_fg  = "#e8734a"
theme.error_fg   = "#d4d8e4"
theme.error_bg   = "#d9534f"

-- Warning colours
theme.warning_fg = "#121419"
theme.warning_bg = "#e89c4a"

-- Notification colours
theme.notif_fg = "#9ca3b5"
theme.notif_bg = "#1a1e25"

-- Menu colours (command completion, bookmark lists, adblock list, …)
theme.menu_fg                   = "#d4d8e4"
theme.menu_bg                   = "#1a1e25"
theme.menu_selected_fg          = "#121419"
theme.menu_selected_bg          = "#e8734a"
theme.menu_title_bg             = "#121419"
theme.menu_primary_title_fg     = "#e8734a"
theme.menu_secondary_title_fg   = "#6b7280"

theme.menu_disabled_fg = "#4d5561"
theme.menu_disabled_bg = theme.menu_bg
theme.menu_enabled_fg  = theme.menu_fg
theme.menu_enabled_bg  = theme.menu_bg
theme.menu_active_fg   = "#7fb069"
theme.menu_active_bg   = theme.menu_bg

-- Proxy manager
theme.proxy_active_menu_fg      = "#d4d8e4"
theme.proxy_active_menu_bg      = "#1a1e25"
theme.proxy_inactive_menu_fg    = "#6b7280"
theme.proxy_inactive_menu_bg    = "#1a1e25"

-- Statusbar
theme.sbar_fg         = "#9ca3b5"
theme.sbar_bg         = "#121419"

-- Download bar
theme.dbar_fg         = "#d4d8e4"
theme.dbar_bg         = "#1a1e25"
theme.dbar_error_fg   = "#d9534f"

-- Input bar. Kept transparent like the default: the bar sits over the statusbar
-- background, and giving it its own solid colour makes a visible seam.
theme.ibar_fg           = "#d4d8e4"
theme.ibar_bg           = "rgba(0,0,0,0)"

-- Tab labels
theme.tab_fg            = "#6b7280"
theme.tab_bg            = "#1a1e25"
theme.tab_hover_bg      = "#252a33"
theme.tab_ntheme        = "#9ca3b5"
theme.selected_fg       = "#e8734a"
theme.selected_bg       = "#121419"
theme.selected_ntheme   = "#d4d8e4"
theme.loading_fg        = "#e89c4a"
theme.loading_bg        = "#121419"

-- Private tabs get the crimson end of the palette, so an incognito window is
-- obvious at a glance instead of a subtle shade difference.
theme.selected_private_tab_bg = "#581724"
theme.private_tab_bg    = "#3a1019"

-- TLS trust. Red/green only would be invisible to a colourblind eye at this size,
-- so trusted is the calm green and untrusted is the same red used for errors —
-- consistent meaning across the whole UI.
theme.trust_fg          = "#7fb069"
theme.notrust_fg        = "#d9534f"

-- Follow-mode hints (the labels shown when you press f)
theme.hint_font = "11px JetBrains Mono, monospace"
theme.hint_fg = "#121419"
theme.hint_bg = "#f2b705"
theme.hint_border = "1px solid #b5583a"
theme.hint_opacity = "0.4"
theme.hint_overlay_bg = "rgba(232,115,74,0.18)"
theme.hint_overlay_border = "1px dotted #e8734a"
theme.hint_overlay_selected_bg = "rgba(127,176,105,0.30)"
theme.hint_overlay_selected_border = theme.hint_overlay_border

-- General colour pairings
theme.ok    = { fg = "#d4d8e4", bg = "#121419" }
theme.warn  = { fg = "#121419", bg = "#e89c4a" }
theme.error = { fg = "#d4d8e4", bg = "#d9534f" }

-- Gopher page style
theme.gopher_light = { bg = "#d4d8e4", fg = "#121419", link = "#b5583a" }
theme.gopher_dark  = { bg = "#121419", fg = "#d4d8e4", link = "#e8734a" }

return theme

-- vim: et:sw=4:ts=8:sts=4:tw=80
