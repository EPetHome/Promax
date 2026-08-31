# Machine-readable handoff manifest

Use `assets/handoff-manifest.template.json` to make artifact existence, traceability, evidence, and promotion conditions executable.

## Top-level fields

| Field | Rule |
| --- | --- |
| `$schema` | Must equal `product-solution-handoff/v1`. |
| `requirement_id` | Stable product requirement or initiative ID. |
| `version` | Version shared by the handoff package. |
| `artifact_state` | `exploration`, `draft`, `review-ready`, or `handoff-ready`. |
| `artifacts` | Named, relative paths. Do not list files that do not exist. |
| `requirements` | Unique IDs matching `FR-NNN`. |
| `acceptance_criteria` | Unique IDs matching `AC-NNN`. |
| `traceability` | Links each requirement to one or more acceptance IDs and real artifact keys. |
| `validation` | Actual status plus evidence path for static, browser, and accessibility smoke checks. |
| `open_conditions` | Remaining condition with ID, severity, owner, and description. |

## State gates

- `exploration`: prototype exists; omissions and review question remain explicit.
- `draft`: solution exists; incomplete validation is allowed and visible.
- `review-ready`: solution, interaction specification, prototype, and audit report exist; required validation is `pass`; all IDs are traceable.
- `handoff-ready`: review-ready conditions plus handoff document; no open blocker/high condition.

All artifact and evidence paths must stay inside the manifest directory. The solution and handoff documents must contain the manifest requirement ID and version. A validation marked `pass` needs a real evidence file with a machine-detectable pass result. Use the validator before claiming readiness.
