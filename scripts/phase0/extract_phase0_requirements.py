from pathlib import Path

source = Path("docs/user_flow_specification.md").read_text(
    encoding="utf-8-sig", errors="replace"
).splitlines()

sections = [
    ("4. Product scope and capability map", 53, 87),
    ("23. Open decisions required before calling the UX flow final", 538, 575),
    ("22. Acceptance criteria for a complete user journey", 518, 538),
    ("19. Authentication, authorization, and ownership are release gates", 470, 503),
]

out = [
    "# Phase 0 — Requirements and Decisions Review",
    "",
    "Source: `docs/user_flow_specification.md`.",
    "Extracted sections are reproduced for review; they are not assumed resolved.",
    ""
]

for title, start, end in sections:
    out += [f"## {title}", ""]
    out += source[start-1:end]
    out += ["", "---", ""]

Path("frontend/phase0_requirements_review.md").write_text(
    "\n".join(out), encoding="utf-8"
)
print("Created frontend/phase0_requirements_review.md")
