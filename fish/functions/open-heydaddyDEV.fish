function open-heydaddyDEV
    set -l HD /home/yash/Github/heydaddy
    set -l BLOG /tmp/hd-backend-local.log
    set -l FLOG /tmp/hd-frontend-local.log

    function _hd_kill
        set -l bp (lsof -ti:8000 2>/dev/null)
        set -l fp (lsof -ti:3000 2>/dev/null)
        test (count $bp) -gt 0; and kill $bp 2>/dev/null
        test (count $fp) -gt 0; and kill $fp 2>/dev/null
        sleep 0.5
    end

    function _hd_start --inherit-variable HD --inherit-variable BLOG --inherit-variable FLOG
        printf '' >$BLOG
        printf '' >$FLOG
        fish -c "cd $HD; env FRONTEND_URL=http://localhost:3000 $HD/.venv/bin/python -m uvicorn backend.main:app --reload --port 8000 >>$BLOG 2>&1" &
        fish -c "cd $HD/frontend; npm run dev >>$FLOG 2>&1" &
        echo "  Starting... (waiting 4s)"
        sleep 4
        echo "✅ HeyDaddy Dev → http://localhost:3000"
        echo "   Logs: tail -f $BLOG   |   tail -f $FLOG"
    end

    echo ""
    echo "🚀 HeyDaddy Dev — starting up"
    _hd_kill
    _hd_start

    while true
        echo ""
        echo "  1) Stop servers"
        echo "  2) Restart servers"
        echo "  3) Exit (servers keep running)"
        read -P "→ " choice
        switch $choice
            case 1
                _hd_kill
                echo "✅ Stopped."
                return
            case 2
                echo "Restarting..."
                _hd_kill
                _hd_start
            case 3
                echo "Bye. Servers still at :3000 / :8000."
                return
            case '*'
                echo "Enter 1, 2, or 3."
        end
    end
end
