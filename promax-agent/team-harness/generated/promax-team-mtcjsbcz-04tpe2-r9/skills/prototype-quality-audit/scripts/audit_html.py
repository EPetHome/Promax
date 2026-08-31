#!/usr/bin/env python3
"""Static heuristic audit for self-contained HTML product prototypes."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


SEVERITY_ORDER = {"BLOCKER": 0, "HIGH": 1, "MEDIUM": 2, "INFO": 3}


def finding(severity: str, code: str, message: str) -> dict[str, str]:
    return {"severity": severity, "code": code, "message": message}


def audit(path: Path) -> dict[str, Any]:
    findings: list[dict[str, str]] = []
    if not path.exists() or not path.is_file():
        return {
            "artifact": str(path),
            "status": "FAIL",
            "summary": {"BLOCKER": 1, "HIGH": 0, "MEDIUM": 0, "INFO": 0},
            "findings": [finding("BLOCKER", "FILE_MISSING", "HTML artifact does not exist or is not a file.")],
        }

    html = path.read_text(encoding="utf-8", errors="replace")
    lower = html.lower()
    markup_without_scripts = re.sub(r"<script\b[^>]*>.*?</script\s*>", "", html, flags=re.I | re.S)

    required_checks = [
        (r"<!doctype\s+html", "BLOCKER", "DOCTYPE_MISSING", "Missing HTML doctype."),
        (r"<meta[^>]+charset=", "HIGH", "CHARSET_MISSING", "Missing explicit character encoding."),
        (r"<meta[^>]+name=[\"']viewport[\"']", "HIGH", "VIEWPORT_MISSING", "Missing responsive viewport declaration."),
        (r"<style(?:\s|>)", "HIGH", "STYLE_MISSING", "No embedded stylesheet found."),
        (r":root\s*\{", "MEDIUM", "TOKENS_MISSING", "No :root design-token block found."),
        (r"--[a-z0-9_-]+\s*:", "MEDIUM", "CSS_VARIABLES_MISSING", "No CSS custom properties found."),
        (r"@media", "HIGH", "RESPONSIVE_RULES_MISSING", "No responsive media query found."),
        (r":focus-visible", "HIGH", "FOCUS_STYLE_MISSING", "No explicit focus-visible style found."),
        (r"prefers-reduced-motion", "MEDIUM", "REDUCED_MOTION_MISSING", "No reduced-motion rule found."),
    ]
    for pattern, severity, code, message in required_checks:
        if not re.search(pattern, lower, re.I):
            findings.append(finding(severity, code, message))

    external_patterns = [
        r"<(?:script|img|iframe|source)[^>]+src\s*=\s*[\"']https?://",
        r"<link[^>]+href\s*=\s*[\"']https?://",
        r"@import\s+(?:url\()?\s*[\"']?https?://",
        r"url\(\s*[\"']?https?://",
    ]
    for pattern in external_patterns:
        if re.search(pattern, html, re.I):
            findings.append(finding("BLOCKER", "EXTERNAL_RUNTIME_DEPENDENCY", "Found an HTTP(S) runtime dependency."))
            break

    if re.search(r"<(?:div|span)[^>]+onclick\s*=", markup_without_scripts, re.I):
        findings.append(finding("HIGH", "NON_SEMANTIC_CLICK_TARGET", "Clickable div/span detected; use a native button or link."))

    ids = re.findall(r"\sid\s*=\s*[\"']([^\"']+)[\"']", markup_without_scripts, re.I)
    duplicate_ids = sorted(item for item, count in Counter(ids).items() if count > 1)
    if duplicate_ids:
        findings.append(finding("HIGH", "DUPLICATE_IDS", "Duplicate id values: " + ", ".join(duplicate_ids[:8])))

    for tag in re.findall(r"<button\b[^>]*>.*?</button\s*>", markup_without_scripts, re.I | re.S):
        attributes = tag.split(">", 1)[0]
        content = re.sub(r"<[^>]+>", "", tag.split(">", 1)[1]).strip()
        if not content and not re.search(r"aria-label\s*=|title\s*=", attributes, re.I):
            findings.append(finding("HIGH", "UNNAMED_BUTTON", "An empty/icon-only button has no aria-label or title."))
            break

    if re.search(r"target\s*=\s*[\"']_blank[\"']", html, re.I) and not re.search(
        r"rel\s*=\s*[\"'][^\"']*(?:noopener|noreferrer)", html, re.I
    ):
        findings.append(finding("MEDIUM", "UNSAFE_NEW_TAB", "A target=_blank link does not declare noopener or noreferrer."))

    if "<script" not in lower:
        findings.append(finding("INFO", "NO_SCRIPT", "No embedded script found; confirm the artifact is intentionally non-interactive."))
    if "aria-live" not in lower and "role=\"status\"" not in lower and "role='status'" not in lower:
        findings.append(finding("INFO", "NO_STATUS_REGION", "No aria-live or status region found; confirm dynamic feedback is unnecessary."))

    findings.sort(key=lambda item: (SEVERITY_ORDER[item["severity"]], item["code"]))
    summary = {level: sum(1 for item in findings if item["severity"] == level) for level in SEVERITY_ORDER}
    status = "FAIL" if summary["BLOCKER"] or summary["HIGH"] else "STATIC PASS"
    return {"artifact": str(path.resolve()), "status": status, "summary": summary, "findings": findings}


def as_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# HTML prototype static audit",
        "",
        f"- Artifact: `{report['artifact']}`",
        f"- Status: **{report['status']}**",
        "- Scope: static heuristics only; browser interaction and visual inspection are still required.",
        "",
        "## Summary",
        "",
    ]
    for level in SEVERITY_ORDER:
        lines.append(f"- {level}: {report['summary'][level]}")
    lines.extend(["", "## Findings", ""])
    if not report["findings"]:
        lines.append("No static findings.")
    else:
        for item in report["findings"]:
            lines.append(f"- **{item['severity']} · {item['code']}** — {item['message']}")
    lines.extend(
        [
            "",
            "## Promotion condition",
            "",
            "A STATIC PASS is not a final acceptance result. Complete the rendered browser checklist and critical-path retest before marking the prototype review-ready or handoff-ready.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path, help="Path to the HTML prototype")
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    parser.add_argument("--output", type=Path, help="Write the report to this path")
    args = parser.parse_args()

    report = audit(args.html)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n" if args.format == "json" else as_markdown(report)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 1 if report["status"] == "FAIL" else 0


if __name__ == "__main__":
    sys.exit(main())
