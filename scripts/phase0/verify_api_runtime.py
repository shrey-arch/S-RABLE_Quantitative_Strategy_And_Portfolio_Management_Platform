import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

REPORT_JSON = ROOT / "frontend" / "api_runtime_verification.json"
REPORT_MD = ROOT / "frontend" / "api_runtime_verification.md"


def main():
    from fastapi.testclient import TestClient
    from app.main import app

    # Each check is deliberately non-destructive.
    checks = [
        {
            "name": "Root endpoint",
            "method": "GET",
            "path": "/",
            "json": None,
            "expected": [200],
            "purpose": "Basic application response",
        },
        {
            "name": "Strategies require authentication",
            "method": "GET",
            "path": "/strategies",
            "json": None,
            "expected": [401],
            "purpose": "Reject unauthenticated access",
        },
        {
            "name": "Broker accounts require authentication",
            "method": "GET",
            "path": "/brokers/accounts",
            "json": None,
            "expected": [401],
            "purpose": "Reject unauthenticated access",
        },
        {
            "name": "Portfolio accounts require authentication",
            "method": "GET",
            "path": "/portfolio/accounts",
            "json": None,
            "expected": [401],
            "purpose": "Reject unauthenticated access",
        },
        {
            "name": "Login rejects missing fields",
            "method": "POST",
            "path": "/auth/login",
            "json": {},
            "expected": [422],
            "purpose": "Request schema validation before handler execution",
        },
        {
            "name": "Registration rejects missing fields",
            "method": "POST",
            "path": "/auth/register",
            "json": {},
            "expected": [422],
            "purpose": "Request schema validation before handler execution",
        },
    ]

    results = []

    # No dependency overrides or mocked authentication are installed.
    client = TestClient(app, raise_server_exceptions=False)

    try:
        for check in checks:
            try:
                response = client.request(
                    method=check["method"],
                    url=check["path"],
                    json=check["json"],
                )
                try:
                    body = response.json()
                except ValueError:
                    body = response.text[:1000]

                passed = response.status_code in check["expected"]
                results.append({
                    "name": check["name"],
                    "method": check["method"],
                    "path": check["path"],
                    "purpose": check["purpose"],
                    "expected_statuses": check["expected"],
                    "actual_status": response.status_code,
                    "passed": passed,
                    "response_content_type": response.headers.get(
                        "content-type"
                    ),
                    "response_body_excerpt": (
                        body if isinstance(body, (dict, list))
                        else str(body)[:1000]
                    ),
                    "error": None,
                })
            except Exception as exc:
                results.append({
                    "name": check["name"],
                    "method": check["method"],
                    "path": check["path"],
                    "purpose": check["purpose"],
                    "expected_statuses": check["expected"],
                    "actual_status": None,
                    "passed": False,
                    "response_content_type": None,
                    "response_body_excerpt": None,
                    "error": f"{type(exc).__name__}: {exc}",
                })
    finally:
        client.close()

    passed_count = sum(item["passed"] for item in results)
    failed_count = len(results) - passed_count

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "check_type": "local FastAPI TestClient smoke tests",
        "total_checks": len(results),
        "passed": passed_count,
        "failed": failed_count,
        "results": results,
        "scope_limitations": [
            "These are local in-process HTTP checks, not deployed-server tests.",
            "Only the listed requests were exercised.",
            "No valid registration or login was attempted.",
            "No authenticated database-backed CRUD operation was attempted.",
            "No resource ownership or cross-user isolation was verified.",
            "A passing authentication rejection does not prove all routes are protected.",
            "Security-sensitive routes remain unverified until dedicated tests exist.",
        ],
    }

    REPORT_JSON.write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )

    lines = [
        "# API Runtime Smoke Verification",
        "",
        f"- Generated (UTC): {report['generated_at_utc']}",
        f"- Total checks: {len(results)}",
        f"- Passed: {passed_count}",
        f"- Failed: {failed_count}",
        "- Database mutations: none intended",
        "- Full endpoint verification: NOT COMPLETE",
        "- Security and ownership audit: NOT COMPLETE",
        "",
        "## Results",
        "",
        "| Check | Expected | Actual | Result |",
        "|---|---|---|---|",
    ]

    for item in results:
        expected = ", ".join(map(str, item["expected_statuses"]))
        actual = (
            str(item["actual_status"])
            if item["actual_status"] is not None else "NO RESPONSE"
        )
        status = "PASS" if item["passed"] else "FAIL"
        lines.append(
            f"| {item['name']} | {expected} | {actual} | {status} |"
        )

    for item in results:
        lines += [
            "",
            f"### {item['name']}",
            f"- Request: `{item['method']} {item['path']}`",
            f"- Purpose: {item['purpose']}",
            f"- Response: `{item['actual_status']}`",
        ]
        if item["error"]:
            lines.append(f"- Error: `{item['error']}`")
        else:
            lines.append(
                "- Body excerpt: `" +
                json.dumps(item["response_body_excerpt"], ensure_ascii=True)
                .replace("`", "'")[:1200] + "`"
            )

    lines += ["", "## Limitations", ""]
    lines += [f"- {note}" for note in report["scope_limitations"]]
    lines.append("")

    REPORT_MD.write_text("\n".join(lines), encoding="utf-8")

    print(f"Checks: {len(results)} | Passed: {passed_count} | Failed: {failed_count}")
    for item in results:
        status = "PASS" if item["passed"] else "FAIL"
        print(
            f"[{status}] {item['method']} {item['path']}: "
            f"expected {item['expected_statuses']}, "
            f"got {item['actual_status']}"
        )
        if item["error"]:
            print(f"       {item['error']}")

    print(f"\nJSON report: {REPORT_JSON}")
    print(f"Markdown report: {REPORT_MD}")

    if failed_count:
        print("\nSMOKE CHECKS NEED INVESTIGATION.")
        return 1

    print("\nOBJECTIVE COMPLETED: ALL SELECTED SAFE SMOKE CHECKS PASSED.")
    print("Only these selected checks are verified; this is not full API verification.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
