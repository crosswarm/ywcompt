# Post-approval local validation

- Scope: YonWork-only intelligent todo cockpit widget, after user-approved real `同意` action for `GRRD260519000003`.
- Approval API result: `/api/approve` accepted job `4d5968260ccb51a684053cbafb8f8171` in background mode.
- Live cockpit widget after sync: `summary.pendingCount=35`, `todoStats.todo=35`, `queryMeta.totalCount=35`, `messages=5`, target `GRRD260519000003` no longer appears in widget messages.
- Live inbox API before source restart: `summary.pendingCount=36`, target remains as `approvalProcessing.state=needs_review`, `reasonCode=APPROVAL_PROCESSING_TIMEOUT`, `remoteOutcome=unknown`.
- Local source fix verification without restarting managed YonWork service: importing patched `normalizeInbox` against the current live `/api/inbox` payload projects `summary.pendingCount=35` and `summaries.pending.total=35`, while preserving the target as `needs_review` for explicit user review/reset.
- ai-workbench focused regression: `jest --runInBand --runTestsByPath tests/approve-inbox-widget.test.ts tests/business-widget-approval-inbox.test.tsx tests/cockpit-workbench-model.test.ts -t ...` passed 6 focused P1 cases.
- ycc normalize regression: `/opt/homebrew/bin/node --test skills/iuap-apcom-myapproval/web/normalize.test.mjs` passed 97 tests.

Remaining operational note: the running service on port 3891 was not restarted because it carries the managed YonWork auth/proxy context. The ycc summary fix is verified at source level and will be reflected after the service reloads.
