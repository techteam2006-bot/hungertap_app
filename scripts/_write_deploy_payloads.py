import json
from pathlib import Path

funcs_dir = Path(r"d:\TROVX WEBS\hungertap_app\supabase\functions")
out_dir = Path(r"C:\Users\LOQ\.cursor\projects\d-TROVX-WEBS-hungertap-app\agent-tools")
out_dir.mkdir(parents=True, exist_ok=True)

specs = [
    ("retry-refund", False),
    ("create-order-v2", True),
    ("razorpay-webhook-v2", False),
]

for name, verify_jwt in specs:
    content = (funcs_dir / name / "index.ts").read_text(encoding="utf-8")
    assert "PLACEHOLDER" not in content
    payload = {
        "project_id": "mgyfyutxtapgggcwkknw",
        "name": name,
        "entrypoint_path": "index.ts",
        "verify_jwt": verify_jwt,
        "files": [{"name": "index.ts", "content": content}],
    }
    out = out_dir / f"_out_{name.replace('-', '_')}.json"
    out.write_text(json.dumps(payload), encoding="utf-8")
    print(name, out.stat().st_size, "jwt=", verify_jwt)
