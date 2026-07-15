# Review

## Repository gate

- Full automated suite: 552/552 passed across 72 suites.
- Syntax: all 43 changed or untracked `.mjs` files passed `node --check`; the user-story JSON parsed successfully.
- Patch hygiene: `git diff --check` passed.
- Three independent review lanes completed; repository-level P0/P1 findings were fixed and covered by regression tests.

## Current YonWork Profile gate

- The protocol v4 service on port 3891 was replaced through the protected handoff path; the detail-snapshot build uses protocol v5 so stale in-memory services are replaced again.
- Managed CLI health reports ready with Profile match, proxy context, CLI readiness and verified identity.
- Direct current-Profile `whoami` stability: 10/10, no missing `yhtUserId`, one stable hashed identity.
- Latest service sync stability: 10/10, zero 401, one stable scope, 42 items each run.
- The task visible in the failure screenshot remains pending; a real sibling-CLI `list-action` call reports `approve` and `return` as available.

## Detail incident

- Root cause: a periodic sync generated a new inbox snapshot while stored details remained on an older snapshot; the server categorized the stale detail as identity, causing the frontend to clear the page and display a false account/tenant switch.
- Fix: stale details are treated as cache misses, stale attachments remain blocked, and enrich staging removes non-current details before fetching. Snapshot issue codes are classified separately from identity issues in the frontend.
- Real verification: five detail API samples returned HTTP 200; browser-harness opened five real rows and waited 8-15 seconds without reproducing the false identity/snapshot error. A real voucher detail displayed 285 CLI-returned fields plus analysis.
- Remaining compatibility gap: some `yonbip-mid-sscpf` work orders cannot yet expose real fields because the installed sibling CLI `loadExtend` cannot resolve the domain appServer. The UI now reports field unavailability without leaking or reusing an old snapshot.

## Approval incident

- Root cause: `runBipCli` appended `--yes` to dangerous commands, while the installed current-Profile `bip-cli.js` rejects that option before sending a request.
- Fix: do not invent CLI confirmation flags; preserve server-side explicit user-action validation; classify capability/path/spawn/argument rejections as pre-request `confirmed_failed` rather than `unknown`.
- Regression coverage includes generated command arguments, executor outcome classification and `/api/approve` response behavior.

## Remaining release gates

- Execute one real approval on an explicitly disposable task and verify the task disappears from the same identity's inbox or appears in completed state exactly once.
- Switch tenant, user and Profile, and run the required refresh/no-leak checks.
- Logout and login in YonWork and verify `AUTH_REQUIRED_IN_YONWORK` plus recovery.
- Platform req-proxy still lacks an atomic expected-scope/task lease, so the final dispatch-time identity guarantee remains an external dependency.
- Upgrade/fix sibling `iuap-apcom-cli` metadata resolution for `domainKey=yonbip-mid-sscpf`, then repeat real detail verification for those work orders.
