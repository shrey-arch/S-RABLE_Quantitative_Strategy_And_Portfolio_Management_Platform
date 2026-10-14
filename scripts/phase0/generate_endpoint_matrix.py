import json
from pathlib import Path

root = Path("frontend")
spec = json.loads((root / "openapi.json").read_text(encoding="utf-8"))
matrix = root / "endpoint_to_page_matrix.md"

def page_for(path, tags):
    tag = (tags or [""])[0].lower()
    if path.startswith("/auth/"):
        return "Register / Login / Account Security"
    if path.startswith("/users/"):
        return "Profile / Account Settings"
    if path.startswith("/brokers/"):
        return "Broker Connections"
    if path.startswith("/strategies"):
        return "Strategies"
    if path.startswith("/instruments"):
        return "Instruments / Market Data"
    if path.startswith("/backtests") or path.startswith("/executions"):
        return "Backtest Setup / Execution History / Results"
    if path.startswith("/orders") or path.startswith("/trades") or path.startswith("/positions"):
        return "Trading Records"
    if path.startswith("/portfolio/"):
        return "Portfolio"
    if path.startswith("/notifications"):
        return "Notifications"
    return "Landing / System"

def cell(value):
    return str(value).replace("|", r"\|").replace("\n", " ")

rows = []
for path, path_item in spec.get("paths", {}).items():
    for method, op in path_item.items():
        if method.lower() not in {"get","post","put","patch","delete","options","head"}:
            continue
        params = op.get("parameters", [])
        request_body = op.get("requestBody", {}).get("content", {})
        req = ""
        for body in request_body.values():
            schema = body.get("schema", {})
            req = schema.get("$ref", schema.get("type", ""))
            if req:
                break
        responses = []
        for code, response in op.get("responses", {}).items():
            types = [
                body.get("schema", {}).get("$ref",
                    body.get("schema", {}).get("type", ""))
                for body in response.get("content", {}).values()
            ]
            responses.append(f"{code}: {', '.join(x for x in types if x)}")
        security = op.get("security", spec.get("security", []))
        rows.append([
            method.upper(), path, ", ".join(op.get("tags", [])),
            op.get("operationId", ""),
            "Yes" if security else "No",
            ", ".join(p.get("name","") for p in params if p.get("in")=="path"),
            ", ".join(p.get("name","") for p in params if p.get("in")=="query"),
            req, "; ".join(responses),
            page_for(path, op.get("tags", [])),
            "NOT LIVE-VERIFIED"
        ])

headers = ["Method","Path","Tag","Operation ID","Security Declared",
           "Path Parameters","Query Parameters","Request Schema","Responses",
           "Frontend Page (initial mapping)","Verification Status"]
lines = [
    "# Phase 0 — Endpoint-to-Page Matrix",
    "",
    f"Source: `openapi.json`; {len(rows)} operations extracted.",
    "",
    "> Initial page mapping is inferred from endpoint paths and tags. Review against",
    "> the approved roadmap and UX specification. OpenAPI security declarations do",
    "> not prove that route-level authentication or ownership checks are implemented.",
    "",
    "| " + " | ".join(headers) + " |",
    "| " + " | ".join(["---"] * len(headers)) + " |"
]
lines += ["| " + " | ".join(cell(v) for v in row) + " |" for row in rows]
matrix.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Updated {matrix} with initial page mappings for {len(rows)} operations.")
