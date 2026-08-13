#!/usr/bin/env bash
# Assemble waveform-options.html from its template plus the commissioned batches.
#
# The batches were written in parallel by four agents against one contract, each
# declaring `const BATCH = [...]`. They are spliced in at the BATCHES marker,
# every one inside its own IIFE so four `const BATCH` declarations can coexist,
# and each pushes onto EXTRA.
#
# Idempotent: it always rebuilds the marker region from the template, so running
# it twice does not stack the batches up twice.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
TPL=waveform-options.template.html
OUT=waveform-options.html
MARK='/* ===== BATCHES ===== */'

[ -f "$TPL" ] || { echo "no $TPL — run this from dots/vox with the template present" >&2; exit 1; }

# Find the marker as a FIXED STRING and splice by line number. Passing it to
# sed as a regex silently matched nothing — `/* ... */` is full of
# metacharacters, so `sed /MARK/q` printed the whole template and `sed 1,/MARK/d`
# printed none of it. The build "succeeded", the page parsed, and twenty designs
# quietly ended up after the code that reads them.
at=$(grep -nxF -- "$MARK" "$TPL" | head -1 | cut -d: -f1)
[ -n "$at" ] || { echo "marker not found in $TPL: $MARK" >&2; exit 1; }

{
  head -n "$at" "$TPL"
  for f in batches/*.js; do
    [ -e "$f" ] || continue
    echo ""
    echo "// ── $(basename "$f") ──────────────────────────────────────────"
    echo "(function(){"
    cat "$f"
    echo "EXTRA.push(...BATCH);"
    echo "})();"
  done
  tail -n "+$((at+1))" "$TPL"
} > "$OUT"

# `node --check` needs a real path ending in .js — handed a /dev/fd process
# substitution it fails on every build and cries wolf about perfectly good
# output. Extract to a temp file instead.
tmp=$(mktemp --suffix=.js)
sed -n '/^<script>/,/^<\/script>/p' "$OUT" | sed '1d;$d' > "$tmp"
if node --check "$tmp" 2>/dev/null; then echo "built $OUT — js ok"
else echo "built $OUT — JS DID NOT PARSE:"; node --check "$tmp" 2>&1 | head -4; fi
rm -f "$tmp"
grep -c '^\s*id:' "$OUT" | sed 's/^/  designs: /'
