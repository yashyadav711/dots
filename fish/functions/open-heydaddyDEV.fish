function open-heydaddyDEV
    set -l HD /home/yash/Github/heydaddy
    set -l BLOG /tmp/hd-backend-local.log
    set -l FLOG /tmp/hd-frontend-local.log

    # --- helpers ---

    function _hd_kill
        pkill -f "uvicorn backend.main" 2>/dev/null
        pkill -f "next dev" 2>/dev/null
        sleep 0.5
    end

    function _hd_start --inherit-variable HD --inherit-variable BLOG --inherit-variable FLOG
        printf '' >$BLOG
        printf '' >$FLOG
        fish -c "cd $HD; env FRONTEND_URL=http://localhost:3000 $HD/.venv/bin/python -m uvicorn backend.main:app --reload --reload-dir $HD/backend --reload-dir $HD/config --port 8000 >>$BLOG 2>&1" &
        fish -c "cd $HD/frontend; npm run dev >>$FLOG 2>&1" &
    end

    # Wait until port is up, max $argv[2] seconds. Prints dots while waiting.
    function _hd_wait_port
        set -l port $argv[1]
        set -l max $argv[2]
        set -l i 0
        while test $i -lt $max
            if ss -tln 2>/dev/null | grep -q ":$port"
                return 0
            end
            printf "."
            sleep 1
            set i (math $i + 1)
        end
        return 1
    end

    # Inline port check — used inside _hd_menu
    function _hd_dot
        if ss -tln 2>/dev/null | grep -q ":$argv[1]"
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
        printf "    Backend   :8000   "; _hd_dot 8000; echo ""
        printf "    Frontend  :3000   "; _hd_dot 3000; echo ""
        printf "    Supabase  :54321  "; _hd_dot 54321; echo ""
        echo ""
        set_color brblack
        echo "  ─────────────────────────────────────"
        set_color normal
        echo "    1)  Backend logs       (q to return)"
        echo "    2)  Frontend logs      (q to return)"
        echo "    3)  Errors only        (q to return)"
        echo "    4)  Peek last 40 lines (both logs)"
        echo "    5)  Open browser  →  :3000"
        echo "    6)  Restart app servers"
        echo "    7)  Start backend only"
        echo "    8)  Start Supabase"
        echo "    9)  Stop servers"
        echo "    0)  Exit  (servers keep running)"
        set_color brblack
        echo "  ─────────────────────────────────────"
        set_color normal
    end

    function _hd_boot --inherit-variable HD --inherit-variable BLOG --inherit-variable FLOG
        _hd_start
        printf "  Waiting for backend"
        if _hd_wait_port 8000 20
            echo ""
            set_color green; echo "  ✅ Backend up"; set_color normal
        else
            echo ""
            set_color brred; echo "  ⚠️  Backend didn't start in 20s — check logs (option 1)"; set_color normal
        end
    end

    # --- main ---

    _hd_kill
    echo ""
    echo "  🚀 HeyDaddy Dev — starting up"
    _hd_boot
    sleep 1

    while true
        _hd_menu
        read -P "  → " choice
        echo ""
        switch $choice
            case 1
                set_color yellow; echo "  Backend logs — press q to return"; set_color normal; echo ""
                less -R +F $BLOG
            case 2
                set_color yellow; echo "  Frontend logs — press q to return"; set_color normal; echo ""
                less -R +F $FLOG
            case 3
                set_color yellow; echo "  Errors/warnings — press q to return"; set_color normal; echo ""
                grep -i "error\|exception\|traceback\|warn\|fail" $BLOG | less -R
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
                set_color yellow; echo "  Restarting app servers..."; set_color normal
                _hd_kill
                _hd_boot
                sleep 1
            case 7
                set_color yellow; echo "  Starting backend only..."; set_color normal
                pkill -f "uvicorn backend.main" 2>/dev/null; sleep 0.3
                printf '' >$BLOG
                fish -c "cd $HD; env FRONTEND_URL=http://localhost:3000 $HD/.venv/bin/python -m uvicorn backend.main:app --reload --reload-dir $HD/backend --reload-dir $HD/config --port 8000 >>$BLOG 2>&1" &
                printf "  Waiting for backend"
                _hd_wait_port 8000 20; and echo ""; and set_color green; and echo "  ✅ Backend up"; and set_color normal
            case 8
                if ss -tln 2>/dev/null | grep -q ":54321"
                    set_color green; echo "  Supabase already running on :54321"; set_color normal
                else
                    set_color yellow; echo "  Starting Supabase... (~60s, in background)"; set_color normal
                    fish -c "cd $HD; supabase start >>/tmp/hd-supabase.log 2>&1" &
                    printf "  Waiting for Supabase"
                    _hd_wait_port 54321 90; and echo ""; and set_color green; and echo "  ✅ Supabase up"; and set_color normal
                end
            case 9
                _hd_kill
                set_color green; echo "  Stopped. (Supabase keeps running)"; set_color normal
                return
            case 0
                set_color green; echo "  Bye — servers at :3000 / :8000."; set_color normal
                return
            case '*'
                set_color brred; echo "  Enter 0–9."; set_color normal
                sleep 0.3
        end
    end
end
