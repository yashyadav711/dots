"""Tests for nhq-issues — pure data-layer unit tests + a textual TUI pilot.

All gh calls are mocked; no network."""
import asyncio
import importlib.util
import os
from datetime import datetime, timedelta, timezone

from importlib.machinery import SourceFileLoader

_BIN = os.path.expanduser("~/Github/dots/bin/nhq-issues")


def _load():
    loader = SourceFileLoader("nhq_issues", _BIN)
    spec = importlib.util.spec_from_loader("nhq_issues", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


N = _load()


# ── pure unit tests ───────────────────────────────────────────────────────

def test_chip_for_derives_from_labels():
    assert N.chip_for(["bug"]) == "🔴"
    assert N.chip_for(["P2"]) == "🔴"           # case-insensitive
    assert N.chip_for(["parked"]) == "🅿️"
    assert N.chip_for(["protocol-3"]) == "🔒"
    assert N.chip_for(["status:on-dev"]) == "🟡"
    assert N.chip_for(["enhancement"]) == "✦"
    assert N.chip_for([]) == ""


def test_age_relative_compaction():
    now = datetime.now(timezone.utc)

    def iso(**kw):
        return (now - timedelta(**kw)).isoformat()

    assert N._age(iso(minutes=30)) == "30m"
    assert N._age(iso(hours=2)) == "2h"
    assert N._age(iso(days=5)) == "5d"
    assert N._age("") == ""
    assert N._age(iso(seconds=3)) == "now"


# ── error isolation: one repo failing must not kill the others ────────────

def test_collect_all_isolates_repo_failure(monkeypatch):
    def fake_fetch_list(repo, state="open"):
        if "broken" in repo:
            raise N.IssuesError("boom")
        return [{"number": 1, "title": "ok", "labels": [], "state": "open",
                 "author": {}, "updatedAt": ""}]
    monkeypatch.setattr(N, "fetch_list", fake_fetch_list)
    grouped = N.collect_all(extra_repos=["some/broken", "good/repo"])
    errs = [x for _, _, x in grouped if isinstance(x, str)]
    lists = [x for _, _, x in grouped if isinstance(x, list)]
    assert errs and "boom" in errs[0]
    assert any(len(x) >= 1 for x in lists)


def test_filter_grouped_search_and_label():
    g = [("heydaddy", "o/r", [
        {"number": 1, "title": "voices bug", "labels": [{"name": "bug"}]},
        {"number": 2, "title": "admin redesign", "labels": [{"name": "enhancement"}]},
        {"number": 3, "title": "voices ok", "labels": [{"name": "esv"}]},
    ])]
    # search matches title or label
    assert [it["number"] for _, _, x in N.filter_grouped(g, "voices") for it in x] == [1, 3]
    # label filter (case-insensitive, all must match)
    assert [it["number"] for _, _, x in N.filter_grouped(g, "", ["bug"]) for it in x] == [1]
    assert [it["number"] for _, _, x in N.filter_grouped(g, "", ["BUG"]) for it in x] == [1]
    # error rows pass through untouched
    ge = [("heydaddy", "o/r", "boom")]
    assert N.filter_grouped(ge, "x")[0][2] == "boom"


def test_distinct_labels_collects_unique():
    g = [("heydaddy", "o/r", [
        {"number": 1, "title": "a", "labels": [{"name": "bug"}, {"name": "ui"}]},
        {"number": 2, "title": "b", "labels": [{"name": "Bug"}]},  # case-insensitive
    ])]
    App = N._build_tui()
    app = App(g)
    assert app._distinct_labels() == ["bug", "ui"]


def test_tui_cycles_project_label_sort():
    g = [
        ("heydaddy", "o/heydaddy", [
            {"number": 1, "title": "a", "labels": [{"name": "bug"}], "state": "open",
             "author": {}, "updatedAt": ""}]),
        ("mirror", "o/mirror", [
            {"number": 9, "title": "m", "labels": [], "state": "open",
             "author": {}, "updatedAt": ""}]),
    ]
    App = N._build_tui()
    app = App(g)

    async def run():
        async with app.run_test(size=(130, 40)) as pilot:
            await pilot.pause()
            assert app.sort == "updated"
            app.action_cycle_sort(); await pilot.pause()
            assert app.sort == "created"
            app.action_cycle_project(); await pilot.pause()  # → heydaddy
            assert app.project_filter == "heydaddy"
            assert len(app.all) == 1
            app.action_cycle_label(); await pilot.pause()    # → bug
            assert app.label_filter == ["bug"]
            await pilot.press("q")
    import asyncio
    asyncio.run(run())
# ── TUI pilot (textual run_test, headless) ─────────────────────────────────

def _seed():
    return [
        ("heydaddy", "yashyadav711/heydaddy", [
            {"number": 187, "title": "voices bug", "labels": [{"name": "bug"}],
             "state": "open", "author": {}, "updatedAt": ""},
            {"number": 198, "title": "admin redesign",
             "labels": [{"name": "enhancement"}], "state": "open",
             "author": {}, "updatedAt": ""},
        ]),
    ]


def test_tui_renders_loads_detail_and_filters(monkeypatch):
    monkeypatch.setattr(N, "fetch_detail", lambda repo, num: {
        "number": int(num), "title": f"T{num}", "body": f"BODY-{num}",
        "state": "open", "labels": [{"name": "bug"}],
        "author": {"login": "tester"}, "createdAt": "", "updatedAt": "",
        "url": "", "comments": []})
    App = N._build_tui()
    app = App(_seed())

    async def run():
        async with app.run_test(size=(120, 40)) as pilot:
            await pilot.pause()
            ol = app.query_one("#list")
            # 1 header + 2 issues
            assert ol.option_count == 3

            # move onto an issue, then ENTER expands it inline (loads detail)
            await pilot.press("down")
            await pilot.pause()
            assert app.expanded is None
            await pilot.press("enter")
            await pilot.pause()
            assert app.expanded is not None
            assert len(app.detail_cache) >= 1
            bodies = " ".join(v.get("body", "") for v in app.detail_cache.values())
            assert "BODY-187" in bodies or "BODY-198" in bodies
            # a det: detail-block row is now present in the list
            ids = [str(app.query_one("#list").get_option_at_index(i).id)
                   for i in range(app.query_one("#list").option_count)]
            assert any(i.startswith("det:") for i in ids)
            # enter again collapses the same issue
            await pilot.press("enter")
            await pilot.pause()
            assert app.expanded is None

            # filter by typing into search
            await pilot.press("/")
            await pilot.pause(0.05)
            await pilot.press(*"admin")
            await pilot.pause()
            assert app.search_q == "admin"
            assert len(app.all) == 1            # only "admin redesign" matches

            # ctrl+c quits (bound alongside q)
            await pilot.press("q")
    asyncio.run(run())
