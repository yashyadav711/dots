"""Tests for bin/nhq-heydaddy-deploy — the deploy trigger / baseline parsing.

Regression cover for the 2026-08-01 prod incident: the frontend deploy printed an
empty "current deployment:" and then aborted with "the deploy trigger failed
(exit 1)" on a redeploy that had actually succeeded, and the re-run that error
demanded produced a duplicate build.

No network. A fake `railway` (and `curl`) are put in front of the real ones on
PATH; the fake is scripted through environment variables so each test can stage
one exact failure shape. GNU `timeout` is deliberately NOT shadowed — the #225
hang protection wraps every railway call in it and must keep working.
"""
import os
import shutil
import subprocess
import textwrap

import pytest

SCRIPT = os.path.expanduser("~/Github/dots/bin/nhq-heydaddy-deploy")

# One deployment id per role, so assertions can name which one was adopted.
OLD_ID = "aaaaaaaa-1111-4111-8111-111111111111"
NEW_ID = "ffb875fa-2222-4222-8222-222222222222"

# The fake `railway`. FAKE_MODE selects the scenario; FAKE_STATE is a counter
# file so successive `deployment list` calls can return different answers.
FAKE_RAILWAY = textwrap.dedent(
    """\
    #!/usr/bin/env bash
    # Fake railway CLI. Only the two subcommands this script uses are modelled.
    n=0
    [[ -f "$FAKE_STATE" ]] && n="$(cat "$FAKE_STATE")"

    emit() {  # emit <id> <status> <created-iso>
      printf '[{"id":"%s","status":"%s","createdAt":"%s"}]\\n' "$1" "$2" "$3"
    }

    case "$1 $2" in
      "deployment list")
        n=$(( n + 1 )); printf '%s' "$n" > "$FAKE_STATE"
        case "$FAKE_MODE" in
          list_unreadable)
            echo "error: unexpected response from backboard (502)" >&2
            exit 1 ;;
          list_garbage)
            echo '<html>502 Bad Gateway</html>' ;;
          no_baseline_then_stale)
            # The baseline read fails, so prev_id is empty; every later call
            # returns only yesterday's SUCCESS. Nothing new ever appears.
            if (( n <= 1 )); then
              echo "error: unexpected response from backboard (502)" >&2
              exit 1
            fi
            emit "$OLD_ID" SUCCESS "$OLD_CREATED" ;;
          no_new_deployment)
            emit "$OLD_ID" SUCCESS "$OLD_CREATED" ;;
          *)
            # Baseline on the first call, then the new build appears.
            if (( n <= 1 )); then emit "$OLD_ID" SUCCESS "$OLD_CREATED"
            elif (( n == 2 )); then emit "$NEW_ID" BUILDING "$NEW_CREATED"
            else emit "$NEW_ID" SUCCESS "$NEW_CREATED"
            fi ;;
        esac
        exit 0 ;;
      "redeploy "*|"redeploy")
        case "$FAKE_MODE" in
          trigger_clean|no_baseline_then_stale) exit 0 ;;
          *)
            # The incident: the mutation lands, then reading the reply blows up.
            echo "error: error decoding response body" >&2
            exit 1 ;;
        esac ;;
    esac
    exit 0
    """
)

FAKE_CURL = "#!/usr/bin/env bash\nprintf '200'\n"


def _iso(delta_s):
    import datetime

    t = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=delta_s)
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def run_deploy(tmp_path, mode, face="nhq-heydaddy-prod-fe-deploy", args=("-y",), env=None):
    """Invoke the real script through one of its symlink faces, with a fake CLI."""
    fakebin = tmp_path / "fakebin"
    fakebin.mkdir(exist_ok=True)
    (fakebin / "railway").write_text(FAKE_RAILWAY)
    (fakebin / "curl").write_text(FAKE_CURL)
    for f in ("railway", "curl"):
        os.chmod(fakebin / f, 0o755)

    link = tmp_path / face
    if not link.exists():
        os.symlink(SCRIPT, link)

    e = dict(os.environ)
    e.update(
        PATH=f"{fakebin}:{e['PATH']}",
        FAKE_MODE=mode,
        FAKE_STATE=str(tmp_path / f"state-{mode}"),
        OLD_ID=OLD_ID,
        NEW_ID=NEW_ID,
        OLD_CREATED=_iso(-86400),   # yesterday — cannot be mistaken for this run
        NEW_CREATED=_iso(0),
        NHQ_DEPLOY_POLL="0",
        NHQ_DEPLOY_TIMEOUT="3",
        NHQ_DEPLOY_RW_TIMEOUT="10",
        NHQ_DEPLOY_TRIGGER_TIMEOUT="10",
        NHQ_DEPLOY_HEALTH_TRIES="1",
    )
    e.update(env or {})
    return subprocess.run(
        [str(link), *args], capture_output=True, text=True, timeout=120, env=e
    )


@pytest.fixture(autouse=True)
def _needs_gnu_timeout():
    t = shutil.which("timeout")
    if not t:
        pytest.skip("GNU timeout not on PATH")


# ── Defect 2: a noisy trigger must not be reported as a failure ──────────────

def test_noisy_trigger_on_a_real_deploy_is_polled_not_aborted(tmp_path):
    """The incident itself.

    `railway redeploy` exits 1 after the deploy mutation has already landed, so a
    new deployment IS there. The script must notice it, poll it to SUCCESS and
    exit 0 — never tell the operator to re-run, which is what produced the
    duplicate build on 2026-08-01.
    """
    r = run_deploy(tmp_path, "noisy_trigger")
    out = r.stdout + r.stderr
    assert r.returncode == 0, out
    assert "NOISY" in out
    assert NEW_ID[:8] in out
    assert "do NOT re-run" in out
    assert "Nothing was polled" not in out


def test_noisy_trigger_still_fails_when_nothing_was_deployed(tmp_path):
    """A genuinely failed trigger must still be a loud failure.

    Same non-zero exit, but the deployment list keeps returning the old build.
    Nothing shipped, so re-running is safe and the script must say so.
    """
    r = run_deploy(tmp_path, "no_new_deployment")
    out = r.stdout + r.stderr
    assert r.returncode == 1, out
    assert "nothing shipped" in out
    assert "re-running is safe" in out


# ── Defect 1: an unreadable baseline must be explicit, not an empty string ───

def test_unreadable_baseline_is_named_with_its_reason(tmp_path):
    """`current deployment:` must never be printed as an empty sentence."""
    r = run_deploy(tmp_path, "list_unreadable")
    out = r.stdout + r.stderr
    assert "current deployment: ⚠ UNKNOWN" in out
    assert "→ current deployment: \n" not in out
    assert "exited 1" in out          # the swallowed railway error is now shown


def test_garbage_json_baseline_reports_the_parse_failure(tmp_path):
    """An HTML error page where JSON was expected is a reason, not silence."""
    r = run_deploy(tmp_path, "list_garbage")
    out = r.stdout + r.stderr
    assert "current deployment: ⚠ UNKNOWN" in out
    assert "unparseable JSON" in out


def test_no_baseline_does_not_adopt_the_previous_deployment(tmp_path):
    """The dangerous twin of the reported bug.

    With no baseline, `id != prev_id` is true for the OLD deployment too. Here
    the baseline read fails and the trigger is CLEAN, so the poll loop runs with
    prev_id empty against a list that only ever holds yesterday's SUCCESS. It
    must not report that as this run's build — it must time out loudly instead.
    """
    r = run_deploy(tmp_path, "no_baseline_then_stale")
    out = r.stdout + r.stderr
    assert r.returncode == 1, out
    assert "TIMED OUT" in out
    assert "live + healthy" not in out


# ── The baseline that parses, and the dry run that proves it ────────────────

def test_readable_baseline_prints_id_and_status(tmp_path):
    r = run_deploy(tmp_path, "trigger_clean")
    out = r.stdout + r.stderr
    assert r.returncode == 0, out
    assert f"current deployment: {OLD_ID[:8]} (SUCCESS)" in out


def test_dry_run_probes_the_baseline_and_triggers_nothing(tmp_path):
    r = run_deploy(tmp_path, "trigger_clean", args=("--dry-run",))
    out = r.stdout + r.stderr
    assert r.returncode == 0, out
    assert "Baseline probe (read-only" in out
    assert f"✓ parsed  id={OLD_ID}  status=SUCCESS" in out
    # A dry run must not have gone near the trigger.
    assert "triggering redeploy" not in out


def test_dry_run_reports_an_unreadable_baseline_as_such(tmp_path):
    r = run_deploy(tmp_path, "list_unreadable", args=("--dry-run",))
    out = r.stdout + r.stderr
    assert r.returncode == 0, out
    assert "⚠ NO BASELINE" in out


# ── #225 hang protection must survive all of the above ──────────────────────

def test_railway_calls_still_run_under_timeout_with_stdin_closed(tmp_path):
    """Load-bearing (#225): every railway call is wrapped in `timeout` and gets
    stdin from /dev/null, so an interactive prompt EOFs instead of hanging."""
    src = open(SCRIPT).read()
    assert 'timeout --kill-after=10 "$t" railway "$@" </dev/null' in src
