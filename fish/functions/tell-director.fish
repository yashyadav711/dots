function tell-director --description "Send a message from Envy to Director's inbox"
    if test (count $argv) -eq 0
        echo "Usage: tell-director \"your message\""
        return 1
    end
    set msg $argv
    set inbox ~/Github/nhq-agentic-os/ai/envy-inbox.md
    set timestamp (date '+%Y-%m-%d %H:%M IST')
    echo "## $timestamp — Envy" >> $inbox
    echo "$msg" >> $inbox
    echo "" >> $inbox
    echo "--- Sent to Director inbox ---"
end
