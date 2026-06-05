function tell-pm --description "Send a message from Envy to PM's inbox"
    if test (count $argv) -eq 0
        echo "Usage: tell-pm \"your message\""
        return 1
    end
    set msg $argv
    set inbox ~/Github/product-manager/ai/envy-inbox.md
    set timestamp (date '+%Y-%m-%d %H:%M IST')
    echo "## $timestamp — Envy" >> $inbox
    echo "$msg" >> $inbox
    echo "" >> $inbox
    echo "--- Sent to PM inbox ---"
end
