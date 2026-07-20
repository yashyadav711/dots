#!/usr/bin/env bash
# selftest for the ok-Yash signature guard changes (nhq-approve + nhq-p3-guard + nhq-jcode-pretool).
set -uo pipefail
BIN="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
APPROVE="$BIN/nhq-approve"
GUARD="$BIN/nhq-p3-guard"
PRETOOL="$BIN/nhq-jcode-pretool"

export NHQ_APPROVAL_STORE="$(mktemp -u /tmp/nhq-approval-selftest.XXXX.json)"
export NHQ_APPROVE_BIN="$APPROVE"
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "== syntax =="
bash -n "$APPROVE" && ok "nhq-approve parses" || no "nhq-approve syntax"
bash -n "$GUARD"   && ok "nhq-p3-guard parses" || no "nhq-p3-guard syntax"
bash -n "$PRETOOL" && ok "nhq-jcode-pretool parses" || no "nhq-jcode-pretool syntax"

echo "== nhq-approve grant/verify/consume =="
"$APPROVE" clear >/dev/null
"$APPROVE" verify --repo heydaddy --target main; [[ $? -ne 0 ]] && ok "no grant → verify fails" || no "verify should fail with empty store"
"$APPROVE" grant --repo heydaddy --target main --ttl 30 >/dev/null && ok "grant ok" || no "grant failed"
"$APPROVE" verify --repo heydaddy --target main && ok "verify passes after grant" || no "verify should pass"
"$APPROVE" consume --repo heydaddy --target main && ok "consume ok" || no "consume failed"
"$APPROVE" verify --repo heydaddy --target main; [[ $? -ne 0 ]] && ok "consumed → verify fails (single-use)" || no "consumed grant should not verify"
# expired
"$APPROVE" clear >/dev/null
"$APPROVE" grant --repo heydaddy --target main --ttl 30 >/dev/null
jq '.[0].expires_at=1' "$NHQ_APPROVAL_STORE" > "$NHQ_APPROVAL_STORE.tmp" && mv "$NHQ_APPROVAL_STORE.tmp" "$NHQ_APPROVAL_STORE"
"$APPROVE" verify --repo heydaddy --target main; [[ $? -ne 0 ]] && ok "expired grant → verify fails" || no "expired grant should not verify"

# ---- helper: build a temp scoped git repo staged with a P3 path ----
mk_repo(){ # $1=name  $2=branch
  local d; d="$(mktemp -d "/tmp/nhq-selftest-$1.XXXX")/$1"; mkdir -p "$d"
  git -C "$d" init -q
  git -C "$d" config user.email t@t; git -C "$d" config user.name t
  git -C "$d" remote add origin "https://github.com/yashyadav711/$1.git" 2>/dev/null || true
  git -C "$d" checkout -q -b "$2" 2>/dev/null || git -C "$d" checkout -q "$2"
  echo init > "$d/README.md"; git -C "$d" add README.md; git -C "$d" commit -q -m init
  mkdir -p "$d/backend/migrations"; echo "-- x" > "$d/backend/migrations/099_selftest.sql"
  git -C "$d" add -A
  echo "$d"
}

echo "== nhq-p3-guard prod P3 commit gate =="
"$APPROVE" clear >/dev/null
R="$(mk_repo heydaddy main)"
out="$("$GUARD" check "$R" pretooluse 2>&1)"; echo "$out" | grep -q 'DENY(no-yash-signature)' && ok "prod P3, no token → DENY(no-yash-signature)" || no "expected no-yash-signature deny; got: $out"
"$APPROVE" grant --repo heydaddy --target main >/dev/null
out="$("$GUARD" check "$R" pretooluse 2>&1)"; echo "$out" | grep -q 'ALLOW(yash-signature-token)' && ok "prod P3 + token → ALLOW(yash-signature-token)" || no "expected allow-with-token; got: $out"
out="$("$GUARD" check "$R" pretooluse 2>&1)"; echo "$out" | grep -q 'DENY(no-yash-signature)' && ok "token single-use (2nd commit denied)" || no "token should be consumed; got: $out"

echo "== fleet still hard-blocked even with token =="
"$APPROVE" grant --repo heydaddy --target main >/dev/null
out="$(NHQ_AGENT=heydaddy "$GUARD" check "$R" pretooluse 2>&1)"; echo "$out" | grep -q 'DENY(fleet-hard-block)' && ok "fleet + token → still fleet-hard-block" || no "fleet must be hard-blocked; got: $out"

echo "== dev/feature scope ungated =="
RD="$(mk_repo heydaddy dev)"
out="$("$GUARD" check "$RD" pretooluse 2>&1)"; echo "$out" | grep -q 'ALLOW(out-of-scope)' && ok "heydaddy@dev → ALLOW(out-of-scope), no token" || no "dev should be ungated; got: $out"
RN="$(mk_repo notaproduct main)"
out="$("$GUARD" check "$RN" pretooluse 2>&1)"; echo "$out" | grep -q 'ALLOW(out-of-scope)' && ok "non-scoped repo → ALLOW(out-of-scope)" || no "non-scoped should be ungated; got: $out"

echo "== jcode-pretool Director push/merge gate =="
run_pt(){ printf '{"command":"%s"}' "$1" | JCODE_HOOK_TOOL_NAME=bash JCODE_HOOK_CWD="$2" "$PRETOOL" 2>&1; echo "rc=$?"; }
"$APPROVE" clear >/dev/null
# push to dev on scoped repo → allowed
o="$(run_pt "git push origin dev" "$RD")"; echo "$o" | grep -q 'rc=0' && ok "push dev (scoped) → allowed" || no "push dev should pass; got: $o"
# push main on scoped repo, no token → blocked
o="$(run_pt "git -C $R push origin main" "$R")"; echo "$o" | grep -qE 'rc=2|ok - Yash' && ok "push main, no token → blocked" || no "push main should block; got: $o"
# with token → allowed
"$APPROVE" grant --repo heydaddy --target main >/dev/null
o="$(run_pt "git -C $R push origin main" "$R")"; echo "$o" | grep -q 'rc=0' && ok "push main + token → allowed" || no "push main+token should pass; got: $o"
# non-scoped repo push main → not gated
o="$(run_pt "git -C $RN push origin main" "$RN")"; echo "$o" | grep -q 'rc=0' && ok "push main non-scoped → not gated" || no "non-scoped push should pass; got: $o"

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[[ $FAIL -eq 0 ]] && echo "SELFTEST GREEN" || echo "SELFTEST RED"
rm -f "$NHQ_APPROVAL_STORE"
exit $FAIL
