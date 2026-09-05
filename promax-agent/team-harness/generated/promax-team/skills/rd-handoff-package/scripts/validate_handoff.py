#!/usr/bin/env python3
"""Validate a product-solution handoff manifest and its local artifacts."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


SEVERITY_ORDER = {"BLOCKER": 0, "HIGH": 1, "MEDIUM": 2, "INFO": 3}
STATES = ("exploration", "draft", "review-ready", "handoff-ready")
REQUIRED_BY_STATE = {
    "exploration": {"prototype"},
    "draft": {"solution"},
    "review-ready": {"solution", "interaction_spec", "prototype", "audit_report"},
    "handoff-ready": {"solution", "interaction_spec", "prototype", "audit_report", "handoff"},
}
VALIDATION_REQUIRED = {
    "review-ready": {"static_audit", "browser_smoke", "accessibility_smoke"},
    "handoff-ready": {"static_audit", "browser_smoke", "accessibility_smoke"},
}


def issue(severity: str, code: str, message: str) -> dict[str, str]:
    return {"severity": severity, "code": code, "message": message}


def duplicates(values: Iterable[str]) -> list[str]:
    return sorted(value for value, count in Counter(values).items() if count > 1)


def safe_resolve(base: Path, value: str) -> Path | None:
    candidate = Path(value)
    if candidate.is_absolute():
        return None
    resolved = (base / candidate).resolve()
    try:
        resolved.relative_to(base)
    except ValueError:
        return None
    return resolved


def validation_status(value: Any) -> tuple[str, str]:
    if isinstance(value, str):
        return value, ""
    if isinstance(value, dict):
        return str(value.get("status", "")), str(value.get("evidence", ""))
    return "", ""


def evidence_supports_pass(path: Path) -> bool:
    if path.suffix.lower() == ".json":
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return False
        return str(payload.get("status", "")).upper() in {"PASS", "STATIC PASS", "PASS_WITH_WARNINGS"}
    content = path.read_text(encoding="utf-8", errors="replace").upper()
    return "PASS" in content or "通过" in content


def validate(manifest_path: Path, target_state: str | None = None) -> dict[str, Any]:
    findings: list[dict[str, str]] = []
    base = manifest_path.resolve().parent
    if not manifest_path.exists() or not manifest_path.is_file():
        return {
            "manifest": str(manifest_path),
            "target_state": target_state or "unknown",
            "status": "FAIL",
            "summary": {"BLOCKER": 1, "HIGH": 0, "MEDIUM": 0, "INFO": 0},
            "findings": [issue("BLOCKER", "MANIFEST_MISSING", "Manifest file does not exist.")],
        }

    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return {
            "manifest": str(manifest_path.resolve()),
            "target_state": target_state or "unknown",
            "status": "FAIL",
            "summary": {"BLOCKER": 1, "HIGH": 0, "MEDIUM": 0, "INFO": 0},
            "findings": [issue("BLOCKER", "MANIFEST_INVALID", f"Cannot parse manifest JSON: {error}")],
        }

    if data.get("$schema") != "product-solution-handoff/v1":
        findings.append(issue("BLOCKER", "SCHEMA_INVALID", "Unsupported or missing $schema."))
    for field in ("requirement_id", "version", "artifact_state", "artifacts", "requirements", "acceptance_criteria", "traceability", "validation", "open_conditions"):
        if field not in data:
            findings.append(issue("BLOCKER", "FIELD_MISSING", f"Required field is missing: {field}."))

    declared_state = str(data.get("artifact_state", ""))
    if declared_state not in STATES:
        findings.append(issue("BLOCKER", "STATE_INVALID", f"Invalid artifact_state: {declared_state!r}."))
    effective_state = target_state or declared_state
    if effective_state not in STATES:
        findings.append(issue("BLOCKER", "TARGET_STATE_INVALID", f"Invalid target state: {effective_state!r}."))
        effective_state = "draft"

    artifacts = data.get("artifacts", {})
    if not isinstance(artifacts, dict):
        findings.append(issue("BLOCKER", "ARTIFACTS_INVALID", "artifacts must be an object keyed by artifact name."))
        artifacts = {}

    content_by_artifact: dict[str, str] = {}
    resolved_artifacts: dict[str, Path] = {}
    for name, spec in artifacts.items():
        if not isinstance(spec, dict) or not isinstance(spec.get("path"), str) or not spec.get("path"):
            findings.append(issue("HIGH", "ARTIFACT_SPEC_INVALID", f"Artifact {name!r} needs a non-empty relative path."))
            continue
        resolved = safe_resolve(base, spec["path"])
        if resolved is None:
            findings.append(issue("BLOCKER", "ARTIFACT_PATH_UNSAFE", f"Artifact {name!r} escapes the manifest directory or is absolute."))
            continue
        resolved_artifacts[name] = resolved
        if not resolved.exists() or not resolved.is_file():
            severity = "BLOCKER" if spec.get("required") or name in REQUIRED_BY_STATE.get(effective_state, set()) else "HIGH"
            findings.append(issue(severity, "ARTIFACT_MISSING", f"Artifact {name!r} does not exist: {spec['path']}"))
            continue
        if resolved.stat().st_size == 0:
            findings.append(issue("HIGH", "ARTIFACT_EMPTY", f"Artifact {name!r} is empty."))
            continue
        if resolved.suffix.lower() in {".md", ".txt", ".html", ".json", ".yaml", ".yml", ".css", ".js"}:
            content_by_artifact[name] = resolved.read_text(encoding="utf-8", errors="replace")

    for required_name in REQUIRED_BY_STATE.get(effective_state, set()):
        if required_name not in artifacts:
            findings.append(issue("BLOCKER", "STATE_ARTIFACT_MISSING", f"State {effective_state!r} requires artifact key {required_name!r}."))

    requirements = data.get("requirements", [])
    criteria = data.get("acceptance_criteria", [])
    if not isinstance(requirements, list) or not all(isinstance(item, str) for item in requirements):
        findings.append(issue("BLOCKER", "REQUIREMENTS_INVALID", "requirements must be a list of strings."))
        requirements = []
    if not isinstance(criteria, list) or not all(isinstance(item, str) for item in criteria):
        findings.append(issue("BLOCKER", "ACCEPTANCE_INVALID", "acceptance_criteria must be a list of strings."))
        criteria = []

    for item in requirements:
        if not re.fullmatch(r"FR-\d{3,}", item):
            findings.append(issue("HIGH", "REQUIREMENT_ID_INVALID", f"Requirement ID must match FR-NNN: {item!r}."))
    for item in criteria:
        if not re.fullmatch(r"AC-\d{3,}", item):
            findings.append(issue("HIGH", "ACCEPTANCE_ID_INVALID", f"Acceptance ID must match AC-NNN: {item!r}."))
    for item in duplicates(requirements):
        findings.append(issue("HIGH", "REQUIREMENT_ID_DUPLICATE", f"Duplicate requirement ID: {item}."))
    for item in duplicates(criteria):
        findings.append(issue("HIGH", "ACCEPTANCE_ID_DUPLICATE", f"Duplicate acceptance ID: {item}."))

    searchable = "\n".join(content_by_artifact.values())
    for item in requirements + criteria:
        if item not in searchable:
            findings.append(issue("MEDIUM", "ID_NOT_FOUND_IN_ARTIFACTS", f"ID {item} is not present in any text artifact."))

    identity_severity = "HIGH" if effective_state in {"review-ready", "handoff-ready"} else "MEDIUM"
    for artifact_name in ("solution", "handoff"):
        content = content_by_artifact.get(artifact_name)
        if not content:
            continue
        if str(data.get("requirement_id", "")) not in content:
            findings.append(issue(identity_severity, "REQUIREMENT_ID_MISMATCH", f"Artifact {artifact_name!r} does not contain the manifest requirement_id."))
        if str(data.get("version", "")) not in content:
            findings.append(issue(identity_severity, "VERSION_MISMATCH", f"Artifact {artifact_name!r} does not contain the manifest version."))

    traceability = data.get("traceability", [])
    if not isinstance(traceability, list):
        findings.append(issue("BLOCKER", "TRACEABILITY_INVALID", "traceability must be a list."))
        traceability = []
    traced_requirements: set[str] = set()
    traced_criteria: set[str] = set()
    for index, row in enumerate(traceability, start=1):
        if not isinstance(row, dict):
            findings.append(issue("HIGH", "TRACE_ROW_INVALID", f"Traceability row {index} must be an object."))
            continue
        requirement = row.get("requirement")
        acceptance = row.get("acceptance", [])
        artifact_names = row.get("artifacts", [])
        if requirement not in requirements:
            findings.append(issue("HIGH", "TRACE_REQUIREMENT_UNKNOWN", f"Trace row {index} references unknown requirement {requirement!r}."))
        else:
            traced_requirements.add(requirement)
        if not isinstance(acceptance, list):
            findings.append(issue("HIGH", "TRACE_ACCEPTANCE_INVALID", f"Trace row {index} acceptance must be a list."))
            acceptance = []
        for acceptance_id in acceptance:
            if acceptance_id not in criteria:
                findings.append(issue("HIGH", "TRACE_ACCEPTANCE_UNKNOWN", f"Trace row {index} references unknown acceptance ID {acceptance_id!r}."))
            else:
                traced_criteria.add(acceptance_id)
        if not isinstance(artifact_names, list) or not artifact_names:
            findings.append(issue("HIGH", "TRACE_ARTIFACT_EMPTY", f"Trace row {index} must reference at least one artifact key."))
        else:
            for artifact_name in artifact_names:
                if artifact_name not in artifacts:
                    findings.append(issue("HIGH", "TRACE_ARTIFACT_UNKNOWN", f"Trace row {index} references unknown artifact {artifact_name!r}."))

    coverage_severity = "HIGH" if effective_state in {"review-ready", "handoff-ready"} else "MEDIUM"
    for item in sorted(set(requirements) - traced_requirements):
        findings.append(issue(coverage_severity, "REQUIREMENT_NOT_TRACED", f"Requirement {item} has no traceability row."))
    for item in sorted(set(criteria) - traced_criteria):
        findings.append(issue(coverage_severity, "ACCEPTANCE_NOT_TRACED", f"Acceptance criterion {item} has no traceability row."))

    validation = data.get("validation", {})
    if not isinstance(validation, dict):
        findings.append(issue("BLOCKER", "VALIDATION_INVALID", "validation must be an object."))
        validation = {}
    allowed_validation = {"pass", "fail", "partial", "not-run"}
    for name, value in validation.items():
        status, evidence = validation_status(value)
        if status not in allowed_validation:
            findings.append(issue("HIGH", "VALIDATION_STATUS_INVALID", f"Validation {name!r} has invalid status {status!r}."))
        if status == "pass":
            if not evidence:
                findings.append(issue("HIGH", "VALIDATION_EVIDENCE_MISSING", f"Validation {name!r} says pass without an evidence path."))
            else:
                resolved_evidence = safe_resolve(base, evidence)
                if resolved_evidence is None or not resolved_evidence.exists() or not resolved_evidence.is_file():
                    findings.append(issue("HIGH", "VALIDATION_EVIDENCE_INVALID", f"Validation {name!r} evidence does not exist or is unsafe: {evidence!r}."))
                elif not evidence_supports_pass(resolved_evidence):
                    findings.append(issue("HIGH", "VALIDATION_EVIDENCE_UNSUPPORTED", f"Validation {name!r} evidence does not contain a machine-detectable pass result."))
        elif status == "fail":
            findings.append(issue("MEDIUM", "VALIDATION_FAILED", f"Validation {name!r} is explicitly marked fail."))
    for required_validation in VALIDATION_REQUIRED.get(effective_state, set()):
        status, _ = validation_status(validation.get(required_validation))
        if status != "pass":
            findings.append(issue("BLOCKER", "STATE_VALIDATION_INCOMPLETE", f"State {effective_state!r} requires {required_validation!r} status pass, got {status or 'missing'!r}."))

    open_conditions = data.get("open_conditions", [])
    if not isinstance(open_conditions, list):
        findings.append(issue("BLOCKER", "OPEN_CONDITIONS_INVALID", "open_conditions must be a list."))
        open_conditions = []
    for index, condition in enumerate(open_conditions, start=1):
        if not isinstance(condition, dict):
            findings.append(issue("HIGH", "OPEN_CONDITION_INVALID", f"Open condition {index} must be an object."))
            continue
        missing = [field for field in ("id", "severity", "owner", "description") if not condition.get(field)]
        if missing:
            findings.append(issue("HIGH", "OPEN_CONDITION_INCOMPLETE", f"Open condition {index} lacks: {', '.join(missing)}."))
        severity = str(condition.get("severity", "")).lower()
        if severity in {"blocker", "high"} and effective_state == "handoff-ready":
            findings.append(issue("BLOCKER", "HANDOFF_CONDITION_BLOCKING", f"Open {severity} condition blocks handoff-ready: {condition.get('id', index)}."))
        elif severity in {"blocker", "high"}:
            findings.append(issue("MEDIUM", "OPEN_CONDITION_BLOCKS_PROMOTION", f"Open {severity} condition must close before handoff-ready: {condition.get('id', index)}."))
        elif severity in {"medium", "low"}:
            findings.append(issue("MEDIUM", "OPEN_CONDITION_REMAINS", f"Open condition remains: {condition.get('id', index)}."))

    findings.sort(key=lambda item: (SEVERITY_ORDER[item["severity"]], item["code"], item["message"]))
    summary = {level: sum(1 for item in findings if item["severity"] == level) for level in SEVERITY_ORDER}
    status = "FAIL" if summary["BLOCKER"] or summary["HIGH"] else "PASS_WITH_WARNINGS" if summary["MEDIUM"] else "PASS"
    return {
        "manifest": str(manifest_path.resolve()),
        "declared_state": declared_state,
        "target_state": effective_state,
        "status": status,
        "summary": summary,
        "artifact_count": len(resolved_artifacts),
        "requirement_count": len(requirements),
        "acceptance_count": len(criteria),
        "findings": findings,
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Product solution handoff validation",
        "",
        f"- Manifest: `{report['manifest']}`",
        f"- Declared state: `{report.get('declared_state', 'unknown')}`",
        f"- Target state: `{report['target_state']}`",
        f"- Result: **{report['status']}**",
        "",
        "## Summary",
        "",
    ]
    for severity in SEVERITY_ORDER:
        lines.append(f"- {severity}: {report['summary'][severity]}")
    lines.extend(["", "## Findings", ""])
    if report["findings"]:
        for item in report["findings"]:
            lines.append(f"- **{item['severity']} · {item['code']}** — {item['message']}")
    else:
        lines.append("No findings.")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="Path to manifest.json")
    parser.add_argument("--target-state", choices=STATES, help="Evaluate promotion without changing the manifest")
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    parser.add_argument("--output", type=Path, help="Write validation output to a file")
    args = parser.parse_args()

    report = validate(args.manifest, args.target_state)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n" if args.format == "json" else render_markdown(report)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 1 if report["status"] == "FAIL" else 0


if __name__ == "__main__":
    sys.exit(main())
