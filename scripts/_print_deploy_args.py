import json
import sys
from pathlib import Path

# Prints deploy args as JSON to stdout for piping into tooling.
name = sys.argv[1]
p = Path(r"C:\Users\LOQ\.cursor\projects\d-TROVX-WEBS-hungertap-app\agent-tools") / f"mcp_args_{name.replace('-', '_')}.json"
if not p.exists():
    p = Path(r"d:\TROVX WEBS\hungertap_app\supabase\migrations_pending\_deploy_payloads") / f"{name}.json"
data = json.loads(p.read_text(encoding="utf-8"))
# Ensure we use the full source from functions/ if payload was minified oddly
src = Path(r"d:\TROVX WEBS\hungertap_app\supabase\functions") / name / "index.ts"
if src.exists():
    data["files"][0]["content"] = src.read_text(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
json.dump(data, sys.stdout, ensure_ascii=False)
