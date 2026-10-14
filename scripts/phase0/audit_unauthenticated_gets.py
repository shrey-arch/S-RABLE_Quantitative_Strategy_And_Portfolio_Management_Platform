import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

REPORT_JSON = ROOT / "frontend" / "unauthenticated_access_audit.json"
REPORT_MD = ROOT / "frontend" / "unauthenticated_access_audit.md"

# Only GET routes. Fake UUIDs are used for resource-detail checks.
checks = [
    ("Public", "GET", "/"),
    ("Protected", "GET", "/users/me"),
    ("Protected", "GET", "/strategies"),
    ("Protected", "GET", "/strategies/00000000-0000-0000-0000-000000000001"),
    ("Catalogue policy unresolved", "GET", "/instruments"),
    ("Catalogue policy unresolved", "GET", "/instruments/00000000-0000-0000-0000-000000000001"),
    ("Protected", "GET", "/brokers/accounts"),
    ("Protected", "GET", "/brokers/accounts/00000000-0000-0000-0000-000000000001"),
    ("Security review required", "GET", "/executions"),
    ("Security review required", "GET", "/executions/00000000-0000-0000-0000-000000000001"),
    ("Security review required", "GET", "/orders"),
    ("Security review required", "GET", "/orders/00000000-0000-0000-0000-000000000001"),
    ("Security review required", "GET", "/trades"),
    ("Security review required", "GET", "/trades/00000000-0000-0000-0000-000000000001"),
    ("Security review required", "GET", "/positions"),
    ("Security review required", "GET", "/positions/00000000-0000-0000-0000-000000000001"),
    ("Protected", "GET", "/portfolio/accounts"),
    ("Security review required", "GET", "/portfolio/accounts/00000000-0000-0000-0000-000000000001"),
    ("Security review required", "GET", "/notifications"),
    ("Security review required", "GET", "/notifications/00000000-0000-0000-0000-000000000001"),
]

def main():
    from fastapi.testclient import TestClient
    from app.main import app

    results = []
    client = TestClient(app, raise_server_exceptions=False)

    try:
        for category, method, path in checks:
            try:
                response = client.get(path)
                code = response.status_code

                if category == "Public":
                    assessment = "PUBLIC_ROUTE_RESPONDED"
                elif code in (401, 403):
                    assessment = "AUTH_REJECTED"
                elif 200 <= code < 300:
                    assessment = "RESPONDED_WITHOUT_AUTH_REVIEW_REQUIRED"
                elif code == 404:
                    assessment = "NOT_FOUND_IN_THIS_REQUEST"
                else:
                    assessment = "INCONCLUSIVE_REVIEW_REQUIRED"

                results.append({
                    "category": category,
                    "method": method,
                    "path": path,
                    "status_code": code,
                    "assessment": assessment,
                    "response_body_saved": False,
                })
            except Exception as exc:
                results.append({
                    "category": category,
                    "method": method,
                    "path": path,
                    "status_code": None,
                    "assessment": "REQUEST_ERROR",
                    "error": f"{type(exc).__name__}: {exc}",
                    "response_body_saved": False,
                })
    finally:
        client.close()

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "total_checks": len(results),
        "results": results,
        "limitations": [
            "GET-only local in-process checks; no mutations intentionally performed.",
            "A response is a signal for review, not proof of an exploitable vulnerability.",
            "A 404 does not establish that authentication is enforced.",
            "A 500 or request error is inconclusive.",
            "Ownership isolation and authenticated cross-user access were not tested.",
            "Catalogue write authorization requires separate review.",
        ],
    }

    REPORT_JSON.write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = [
        "# Unauthenticated GET Access Audit",
        "",
        f"- Generated (UTC): {report['generated_at_utc']}",
        f"- Requests: {len(results)}",
        "- Request methods: GET only",
        "- Response bodies saved: No",
        "",
        "| Category | Route | Status | Assessment |",
        "|---|---|---:|---|",
    ]

    for item in results:
        code = item.get("status_code")
        lines.append(
            f"| {item['category']} | `{item['method']} {item['path']}` "
            f"| {code if code is not None else 'ERROR'} "
            f"| {item['assessment']} |"
        )

    lines += ["", "## Limitations", ""]
    lines += [f"- {note}" for note in report["limitations"]]
    lines.append("")
    REPORT_MD.write_text("\n".join(lines), encoding="utf-8")

    print(f"Requests: {len(results)}")
    for item in results:
        print(
            f"{item.get('status_code', 'ERROR')!s:>5} "
            f"{item['method']} {item['path']} "
            f"=> {item['assessment']}"
        )
        if item.get("error"):
            print(f"      {item['error']}")

    print(f"\nJSON report: {REPORT_JSON}")
    print(f"Markdown report: {REPORT_MD}")
    print("\nAUDIT RUN COMPLETE. Findings still require route-policy review.")

if __name__ == "__main__":
    main()
