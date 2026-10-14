import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
SAVED_SPEC = ROOT / "frontend" / "openapi.json"
REPORT_JSON = ROOT / "frontend" / "api_contract_verification.json"
REPORT_MD = ROOT / "frontend" / "api_contract_verification.md"

sys.path.insert(0, str(BACKEND))


def operations(spec):
    result = {}
    for route, path_item in spec.get("paths", {}).items():
        for method, operation in path_item.items():
            if method.lower() not in {
                "get", "post", "put", "patch", "delete", "options", "head"
            }:
                continue

            key = (method.upper(), route)
            result[key] = {
                "operation_id": operation.get("operationId"),
                "tags": operation.get("tags", []),
                "request_body": operation.get("requestBody") is not None,
                "parameters": [
                    {
                        "name": p.get("name"),
                        "in": p.get("in"),
                        "required": p.get("required", False),
                    }
                    for p in operation.get("parameters", [])
                ],
                "responses": sorted(operation.get("responses", {}).keys()),
                "security_declared": (
                    "security" in operation
                    or "security" in spec.get("paths", {}).get(route, {})
                ),
            }
    return result


def main():
    if not SAVED_SPEC.exists():
        raise SystemExit(f"Saved OpenAPI contract not found: {SAVED_SPEC}")

    saved = json.loads(SAVED_SPEC.read_text(encoding="utf-8-sig"))

    try:
        from app.main import app
        live = app.openapi()
    except Exception as exc:
        raise SystemExit(
            "Could not import the live FastAPI application. "
            f"Check backend configuration. Error: {exc}"
        ) from exc

    saved_ops = operations(saved)
    live_ops = operations(live)

    saved_keys = set(saved_ops)
    live_keys = set(live_ops)

    missing_live = sorted(saved_keys - live_keys)
    unexpected_live = sorted(live_keys - saved_keys)

    changed_ids = []
    changed_responses = []
    for key in sorted(saved_keys & live_keys):
        before = saved_ops[key]
        now = live_ops[key]
        label = f"{key[0]} {key[1]}"

        if before["operation_id"] != now["operation_id"]:
            changed_ids.append({
                "operation": label,
                "saved": before["operation_id"],
                "live": now["operation_id"],
            })

        if before["responses"] != now["responses"]:
            changed_responses.append({
                "operation": label,
                "saved": before["responses"],
                "live": now["responses"],
            })

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "saved_spec": str(SAVED_SPEC.relative_to(ROOT)),
        "live_app_title": live.get("info", {}).get("title"),
        "saved_operation_count": len(saved_ops),
        "live_operation_count": len(live_ops),
        "missing_from_live_app": [
            {"method": m, "path": p} for m, p in missing_live
        ],
        "unexpected_in_live_app": [
            {"method": m, "path": p} for m, p in unexpected_live
        ],
        "operation_id_changes": changed_ids,
        "response_status_changes": changed_responses,
        "inventory_matches": not missing_live and not unexpected_live,
        "endpoint_runtime_verified": False,
        "security_verified": False,
        "note": (
            "This compares OpenAPI inventories only. It does not send HTTP "
            "requests and does not verify runtime behavior, authorization, "
            "resource ownership, or database effects."
        ),
    }

    REPORT_JSON.write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )

    lines = [
        "# API Contract Verification",
        "",
        f"- Generated (UTC): {report['generated_at_utc']}",
        f"- Saved operations: {len(saved_ops)}",
        f"- Live operations: {len(live_ops)}",
        f"- Inventory match: {'YES' if report['inventory_matches'] else 'NO'}",
        "- Runtime endpoint verification: NOT PERFORMED",
        "- Security and ownership verification: NOT PERFORMED",
        "",
        "## Operations missing from live application",
    ]

    lines += (
        [f"- `{m} {p}`" for m, p in missing_live]
        if missing_live else ["- None"]
    )

    lines += ["", "## Operations present only in live application"]
    lines += (
        [f"- `{m} {p}`" for m, p in unexpected_live]
        if unexpected_live else ["- None"]
    )

    lines += ["", "## Operation ID changes"]
    lines += (
        [
            f"- `{item['operation']}`: saved `{item['saved']}`, "
            f"live `{item['live']}`"
            for item in changed_ids
        ]
        if changed_ids else ["- None"]
    )

    lines += ["", "## Response status declaration changes"]
    lines += (
        [
            f"- `{item['operation']}`: saved {item['saved']}, "
            f"live {item['live']}"
            for item in changed_responses
        ]
        if changed_responses else ["- None"]
    )

    lines += [
        "",
        "## Interpretation",
        "",
        report["note"],
        "",
    ]

    REPORT_MD.write_text("\n".join(lines), encoding="utf-8")

    print(f"Saved operations: {len(saved_ops)}")
    print(f"Live operations: {len(live_ops)}")
    print(f"Missing from live: {len(missing_live)}")
    print(f"Unexpected in live: {len(unexpected_live)}")
    print(f"Operation ID changes: {len(changed_ids)}")
    print(f"Response declaration changes: {len(changed_responses)}")
    print(f"\nJSON report: {REPORT_JSON}")
    print(f"Markdown report: {REPORT_MD}")

    if not report["inventory_matches"]:
        print("\nCONTRACT CHECK FAILED: operation inventory differs.")
        return 1

    print("\nOBJECTIVE COMPLETED: SAVED AND LIVE OPERATION INVENTORIES MATCH.")
    print("Note: runtime and security verification are still outstanding.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
