# approve-inbox API Commandization Design

## Command Design

- Extend `@bip-cli/iuap-workflow` with approve-inbox-specific `workflow inboxtask` commands.
- Keep commands small and stable:
  - `list-inbox`: returns raw-enough todo rows plus normalized pagination metadata.
  - `get-document`: accepts `web-url`, `todo-id`, optional `downloadAttachments`/`outputDir`, and returns `{ kind, businessKey, fields, attachments, richDetail }`.
  - `list-action`: accepts todo identity and returns normalized approve/reject action availability.
  - `approve-iform`, `reject-iform`, `approve-patch`: write commands, all `dangerous: true`.
  - `get-intelligent-result`: accepts `taskId`, `businessKey`, optional `yhtUserId`, and returns normalized audit result.
- Strengthen `batch-approve` and `batch-reject` by adding `dangerous: true` and route metadata.

## iuap-apcom-myapproval Integration

- Add `scripts/bip-cli-client.mjs` as the only process boundary for `iuap-apcom-cli`.
- `runBipCli(commandPath, input, options)` writes complex input to stdin through `--input - --format json`; dangerous commands append `--yes`.
- `sync-inbox.mjs`, `fetch-bill-detail.mjs`, `approval-executor.mjs`, and `cloud-audit-result.mjs` call the client instead of direct YonBIP fetches.
- Retain local server REST shape and local model analysis path.

## Error Mapping

- CLI non-zero exit maps to the existing `fetch_failed`, `detail_failed`, or approval result errors.
- CLI JSON with `success === false` is treated as failure for write commands.
- Detail output preserves enough diagnostics in `richDetail.debug` without leaking credentials.

## Files

- bip-cli: `packages/iuap/workflow/src/commands/inboxtask/*`, existing batch task command metadata, `gateway-routes.ts`, `index.ts`, `apps/bip-cli/src/registry.ts`.
- iuap-apcom-myapproval: `scripts/bip-cli-client.mjs`, `scripts/sync-inbox.mjs`, `scripts/fetch-bill-detail.mjs`, `scripts/approval-executor.mjs`, `scripts/cloud-audit-result.mjs`, tests.
