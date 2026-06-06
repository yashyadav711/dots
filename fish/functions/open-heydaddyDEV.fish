function open-heydaddyDEV
    set -l HD /home/yash/Github/heydaddy
    set -l BLOG /tmp/hd-backend-local.log
    set -l FLOG /tmp/hd-frontend-local.log

    function _hd_kill
        pkill -f "uvicorn backend.main" 2>/dev/null
        pkill -f "next dev" 2>/dev/null
        sleep 0.5
    end

    function _hd_start --inherit-variable HD --inherit-variable BLOG --inherit-variable FLOG
        printf '' >$BLOG
        printf '' >$FLOG
        fish -c "cd $HD; env FRONTEND_URL=http://localhost:3000 $HD/.venv/bin/python -m uvicorn backend.main:app --reload --port 8000 >>$BLOG 2>&1" &
        fish -c "cd $HD/frontend; npm run dev >>$FLOG 2>&1" &
    end

    function _hd_port_up
        ss -tln 2>/dev/null | grep -q ":$argv[1] "
    end

    function _hd_dot
        if _hd_port_up $argv[1]
            set_color green;  printf "● RUNNING"; set_color normal
        else
            set_color brred;  printf "○ STOPPED"; set_color normal
        end
    end

    function _hd_menu
        clear
        set_color --bold brwhite
        echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        set_color --bold brcyan
        echo "    🚀  HeyDaddy Dev — Local"
        set_color --bold brwhite
        echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        set_color normal
        echo ""
        printf "    Backend  :8000   "; _hd_dot 8000; echo ""
        printf "    Frontend :3000   "; _hd_dot 3000; echo ""
        echo ""
        set_color brblack
        echo "  ─────────────────────────────────────"
        set_color normal
        echo "    1)  Backend logs       (live tail)"
        echo "    2)  Frontend logs      (live tail)"
        echo "    3)  Errors only        (live tail)"
        echo "    4)  Peek last 40 lines (both logs)"
        echo "    5)  Open browser  →  :3000"
        echo "    6)  Restart servers"
        echo "    7)  Stop servers"
        echo "    8)  Exit  (servers keep running)"
        set_color brblack
        echo "  ─────────────────────────────────────"
        set_color normal
    end

    # Boot
    _hd_kill
    _hd_start
    set_color cyan; echo "  Starting... (waiting 4s)"; set_color normal
    sleep 4

    while true
        _hd_menu
        read -P "  → " choice
        echo ""
        switch $choice
            case 1
                set_color yellow; echo "  Backend logs — Ctrl+C to return to menu"; set_color normal; echo ""
                tail -f $BLOG
            case 2
                set_color yellow; echo "  Frontend logs — Ctrl+C to return to menu"; set_color normal; echo ""
                tail -f $FLOG
            case 3
                set_color yellow; echo "  Errors/warnings — Ctrl+C to return"; set_color normal; echo ""
                tail -f $BLOG | grep --line-buffered -i "error\|exception\|traceback\|warn\|fail"
            case 4
                set_color cyan; echo "  ── Backend (last 40) ──────────────────"; set_color normal
                tail -40 $BLOG
                echo ""
                set_color cyan; echo "  ── Frontend (last 40) ─────────────────"; set_color normal
                tail -40 $FLOG
                echo ""
                read -P "  (enter to return) " _
            case 5
                xdg-open http://localhost:3000 2>/dev/null
                set_color green; echo "  Opened → http://localhost:3000"; set_color normal
                sleep 1
            case 6
                set_color yellow; echo "  Restarting..."; set_color normal
                _hd_kill
                _hd_start
                set_color cyan; echo "  Starting... (waiting 4s)"; set_color normal
                sleep 4
            case 7
                _hd_kill
                set_color green; echo "  Stopped."; set_color normal
                return
            case 8
                set_color green; echo "  Bye — servers at :3000 / :8000."; set_color normal
                return
            case '*'
                set_color brred; echo "  Enter 1–8."; set_color normal
                sleep 0.3
        end
    end
end
