# Repository working rules

## Environment boundary (mandatory)

- All inspection, development, debugging, tests, Git operations, releases, and deployments for this repository must run only in an approved cloud workspace, GitHub workflow, or the explicitly authorized online BaoTa project.
- Never access, read, modify, execute, or use a fallback copy from the user's local computer, local IDE, local filesystem, or local sessions.
- A cloud task does not by itself authorize pushing, merging, deploying, production database access, paid-provider calls, or production writes. Those actions still require the user's explicit authorization for the specific operation.
- If the approved cloud environment is unavailable, stop and report the blocker. Do not work around it with a local copy.

## Commercial safety

- Do not invent prices, commission rates, benefits, refund promises, or payout rules. Unconfigured commercial features must stay disabled and fail visibly.
- Use isolated fixtures for state-changing tests unless the user explicitly authorizes a named online test target. Never delete real production users or make real payments during verification.
