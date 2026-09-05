# HTML prototype contract

## Artifact declaration

- Version and date
- Level: exploration / delivery
- State: exploration / draft / review-ready / handoff-ready
- Review questions
- Covered requirement and acceptance IDs
- Explicit omissions

## Experience contract

- Entry point and primary task
- Navigation model
- Page/state map
- Critical happy path
- Validation and recovery paths
- Empty, loading, error, success, disabled, and permission states in scope
- Keyboard and responsive behavior

## Mock contract

Identify every mock data set, simulated delay, simulated success/error, and non-persistent change. The interface must not imply a real backend or stored result when none exists.

## Promotion contract

Exploration → draft requires the named product question to be answered and decisions recorded.

Draft → review-ready requires static pass, browser inspection, and no unresolved blocker/high finding.

Review-ready → handoff-ready additionally requires version alignment with the product solution and interaction specification, plus completed traceability and R&D handoff package.
