# ~/Github/dots/tests/test_dailyimage.py
import importlib.util, importlib.machinery, os, yaml
loader = importlib.machinery.SourceFileLoader("ndi", os.path.expanduser("~/Github/dots/bin/nhq-daily-image"))
spec = importlib.util.spec_from_file_location("ndi", os.path.expanduser("~/Github/dots/bin/nhq-daily-image"), loader=loader)
ndi = importlib.util.module_from_spec(spec); spec.loader.exec_module(ndi)

def test_build_prompt_inserts_motif():
    cfg = {"image":{"template":"art, {section_motif}, no text","motifs":{"ai_today":"neural net"}}}
    p = ndi.build_prompt("ai_today", cfg)
    assert "neural net" in p and "{section_motif}" not in p
