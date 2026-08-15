---------------------------------------------------------------------------
-- luakit userconf — Yash / NHQ
--
-- rc.lua requires this file LAST, so every module it loads is already available
-- and this file only adds and overrides. Worth knowing what is already on, because
-- three items on the original checklist were already done by default:
--
--   adblock, adblock_chrome   loaded — but with NO filter list it blocks nothing,
--                             so the real work was fetching one (see below)
--   quickmarks, bookmarks     loaded
--   downloads, downloads_chrome, styles, webinspector, undoclose, clear_data
--
-- Setting names were read out of /usr/share/luakit/lib for THIS build (2.4.0),
-- not assumed. One in particular differs from the obvious guess:
--   webview.enable_smooth_scrolling   — not "smooth_scrolling"
--
-- Check this file after editing, without opening a window:
--   luakit -k
---------------------------------------------------------------------------

local modes     = require "modes"
local settings  = require "settings"
local downloads = require "downloads"
local window    = require "window"

-- ── Homepage ──────────────────────────────────────────────────────────────
-- about:blank is the fastest possible start page and needs no network. The
-- new-tab page stays luakit's own, which lists bookmarks.
settings.window.home_page = "about:blank"

-- ── Search engines ────────────────────────────────────────────────────────
-- Typing `:open dd rust traits` searches DuckDuckGo. `default` is what a bare
-- `:open some words` uses when the input is not a URL.
settings.window.search_engines = {
    g          = "https://www.google.com/search?q=%s",
    dd         = "https://duckduckgo.com/?q=%s",
    yt         = "https://www.youtube.com/results?search_query=%s",
    gh         = "https://github.com/search?q=%s&type=repositories",
    re         = "https://www.reddit.com/search/?q=%s",
    aw         = "https://wiki.archlinux.org/index.php?search=%s",
    wiki       = "https://en.wikipedia.org/w/index.php?search=%s",
    aur        = "https://aur.archlinux.org/packages?K=%s",
    -- Google is the default per the brief; the rest are one prefix away.
    default    = "https://www.google.com/search?q=%s",
}
settings.window.default_search_engine = "default"

-- ── Privacy ───────────────────────────────────────────────────────────────
-- Third-party cookies are what cross-site trackers ride on; first-party ones are
-- what keep you logged in. "no_third_party" is the setting that drops the former
-- without logging you out of everything. (Values: always | never | no_third_party)
soup.accept_policy = "no_third_party"

-- Deliberately NOT set here, having checked the defaults in
-- /usr/share/luakit/lib/webview.lua for this build:
--   enable_dns_prefetching    already false — it would leak the domains of links
--                             you never clicked to your resolver
--   enable_hyperlink_auditing already false — that is <a ping> tracking
-- Setting either would be noise that reads like protection.
--
-- Referer control is a separate thing and rc.lua already loads it
-- (referer_control_wm), so there is nothing to add for it either.

-- ── Webview behaviour ─────────────────────────────────────────────────────
settings.webview.enable_smooth_scrolling   = true
settings.webview.enable_developer_extras   = true   -- then: :inspect  or  Ctrl-Shift-I
settings.webview.enable_webgl              = true
settings.webview.hardware_acceleration_policy = "always"
settings.webview.default_charset           = "utf-8"

-- Leave the user agent alone by default. A custom UA makes you MORE identifiable,
-- not less, because almost nobody else sends yours. Uncomment only for a site that
-- refuses the real one:
-- settings.webview.user_agent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

-- ── Downloads ─────────────────────────────────────────────────────────────
-- ~/Downloads, matching every other app on this machine. Created if absent,
-- because luakit fails the download rather than making the directory.
downloads.default_dir = os.getenv("HOME") .. "/Downloads"
luakit.spawn(string.format("mkdir -p %q", downloads.default_dir))
downloads.add_signal("download-location", function (uri, file)
    if not file or file == "" then file = "download" end
    return downloads.default_dir .. "/" .. file
end)

-- ── Quick access: g? shortcuts ────────────────────────────────────────────
-- `gh` is already luakit's "go home", so the sites live on their own letters and
-- the ones the brief asked for keep their meaning. Capital variants open in a new
-- tab, which is luakit's existing convention (gh / gH).
local quick = {
    y = { "https://www.youtube.com",            "YouTube" },
    m = { "https://mail.google.com",            "Gmail" },
    g = { "https://github.com",                 "GitHub" },
    r = { "https://www.reddit.com",             "Reddit" },
    w = { "https://wiki.archlinux.org",         "Arch Wiki" },
    c = { "https://chatgpt.com",                "Chat AI" },
    l = { "http://192.168.31.171",              "Rig — Open WebUI (local models)" },
}
local quick_binds = {}
for key, site in pairs(quick) do
    local uri, name = site[1], site[2]
    table.insert(quick_binds, { "^g" .. key .. "$", "Open " .. name .. ".",
        function (w) w:navigate(uri) end })
    table.insert(quick_binds, { "^g" .. key:upper() .. "$", "Open " .. name .. " in a new tab.",
        function (w) w:new_tab(uri) end })
end
modes.add_binds("normal", quick_binds)

-- ── Tabs ──────────────────────────────────────────────────────────────────
-- luakit already has: d close, u undo close, gt/gT cycle, g0/g$ first/last,
-- and counts like 2gt. These add the muscle memory from mainstream browsers so
-- both work.
modes.add_binds("normal", {
    { "<Control-t>",       "Open a new tab.",
        function (w) w:new_tab(settings.get_setting("window.home_page")) end },
    { "<Control-w>",       "Close the current tab.",
        function (w) w:close_tab() end },
    { "<Control-Shift-t>", "Undo the last closed tab.",
        function (w) w:undo_close_tab() end },
    { "<Control-Tab>",     "Next tab.",       function (w) w:next_tab() end },
    { "<Control-Shift-Tab>", "Previous tab.", function (w) w:prev_tab() end },

    -- Pin: luakit has no pinning, but taborder does have "put this first and keep
    -- it there", which is the part of pinning that matters.
    { "^gp$", "Move this tab to the front (pin-ish).",
        function (w)
            w.tabs:reorder(w.view, 1)
            w:notify("tab moved to the front")
        end },
})

-- ── Navigation ────────────────────────────────────────────────────────────
-- H/L, r, gg/G, Ctrl-d/u and zi/zo/zz already exist. These are the extras.
modes.add_binds("normal", {
    { "<Alt-Left>",   "Go back.",    function (w, m) w:back(m.count or 1) end },
    { "<Alt-Right>",  "Go forward.", function (w, m) w:forward(m.count or 1) end },
    { "<Control-r>",  "Reload, bypassing the cache.", function (w) w:reload(true) end },
    { "<Escape>",     "Stop loading.", function (w) w:stop() end },
    { "<Home>",       "Scroll to the top.",    function (w) w:scroll{ ypct = 0 } end },
    { "<End>",        "Scroll to the bottom.", function (w) w:scroll{ ypct = 100 } end },
    { "<Control-0>",  "Reset zoom.", function (w) w:zoom_set() end },
})

-- ── Quickmarks ────────────────────────────────────────────────────────────
-- Seeded once. `go a` opens one, `gn a` in a new tab, `:qmark` edits them, and
-- because they persist in luakit's own store this must not run on every start or
-- it would overwrite edits made from inside the browser.
local qm_seeded = luakit.data_dir .. "/.nhq-quickmarks-seeded"
if not lfs.attributes(qm_seeded) then
    local quickmarks = require "quickmarks"
    quickmarks.set("a", { "https://aur.archlinux.org", "https://archlinux.org/packages" })
    quickmarks.set("h", { "http://192.168.31.171" })              -- rig: Open WebUI
    quickmarks.set("k", { "https://github.com/yashyadav711" })
    quickmarks.set("n", { "https://news.ycombinator.com" })
    local f = io.open(qm_seeded, "w")
    if f then f:write(os.date()) f:close() end
end

-- ── Fonts ─────────────────────────────────────────────────────────────────
settings.webview.default_font_family            = "Noto Sans"
settings.webview.default_font_size              = 16
settings.webview.default_monospace_font_size    = 14

-- ── Dark websites ─────────────────────────────────────────────────────────
-- There is deliberately no setting here. luakit 2.4 has NO dark-mode setting —
-- `webview.prefer_dark_mode` does not exist and assigning it makes the whole rc
-- fail to load, falling back to defaults (found by running luakit for real; the
-- config checker `luakit -k` does not catch it, because it never executes this
-- file).
--
-- Dark comes from GTK instead, and this machine already asks for it:
--   ~/.config/gtk-3.0/settings.ini  gtk-application-prefer-dark-theme=1
--   gsettings org.gnome.desktop.interface color-scheme = 'prefer-dark'
-- WebKit turns that into `prefers-color-scheme: dark`, so every site with its own
-- dark mode switches by itself — no CSS injection, nothing to maintain.
--
-- What remains is the minority of sites that only ship light. Those are handled by
-- the `styles` module (already loaded) reading
-- ~/.local/share/luakit/styles/*.css, scoped per domain — see nhq-dark.css there.
-- Deliberately NOT a global invert: blanket filters wreck photos, and double-darken
-- the sites that were already dark.
--   :styles-list   see and toggle what is active

-- ── Adblock ───────────────────────────────────────────────────────────────
-- Already required by rc.lua. Listed here only as a reminder that the module
-- without a filter list is a no-op — the list lives in
-- ~/.local/share/luakit/adblock/ and `:adblock-list` shows what actually loaded.
local adblock = require "adblock"
adblock.enabled = true

-- vim: et:sw=4:ts=8:sts=4:tw=80
