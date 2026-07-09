# Trace

- research: done
- design: done
- critique: done, gate approved by explicit implementation request
- implement: done
- review: done
- ship: ready for user review, not committed

## Implemented

- Added approve-inbox-specific bip-cli `workflow inboxtask` commands:
  - `list-inbox`
  - `get-document`
  - `list-action`
  - `approve-iform`
  - `reject-iform`
  - `approve-patch`
  - `get-intelligent-result`
- Strengthened existing bip-cli `workflow task` commands:
  - `batch-approve` / `batch-reject` metadata now includes `dangerous: true` and gateway route metadata.
- Added approve-inbox CLI client:
  - `skills/iuap-apcom-myapproval/scripts/bip-cli-client.mjs`
  - all complex inputs go through `--input - --format json`; write commands append `--yes`.
- Replaced active approve-inbox business access paths:
  - sync -> `workflow inboxtask list-inbox`
  - detail/frameworks/attachments -> `workflow inboxtask get-document`
  - action refresh -> `workflow inboxtask list-action`
  - MDF batch approve/reject -> `workflow task batch-approve/batch-reject`
  - patch approve -> `workflow inboxtask approve-patch`
  - iForm approve/reject -> `workflow inboxtask approve-iform/reject-iform`
  - intelligent audit -> `workflow inboxtask get-intelligent-result`
- Removed or disabled legacy direct business call paths in approve-inbox runtime source.
- Added regression guard forbidding direct business `fetch(` call sites outside allowed local APIs/local model/local browser probes.

## YonClaw Boundary

- approve-inbox does not decide whether to use YonClaw or direct BIP for business APIs.
- approve-inbox calls `iuap-apcom-cli` only.
- `iuap-apcom-cli` owns the unified HTTP pipeline and may route through Browser Relay, YonClaw (`YONCLAW_REQ_PROXY_BASE_URL`), API Gateway, or local cookie according to its own runtime configuration.
- Local `/api/*`, widget page requests, local file preview, local browser CDP, and local model `127.0.0.1:3211` remain outside this migration.

## Verification

- bip-cli:
  - `pnpm test` -> 144 files / 2814 tests passed
  - `pnpm build` -> passed; synchronized `skills/iuap-apcom-cli/scripts/bip-cli.js`
  - `pnpm dev workflow inboxtask get-intelligent-result --schema` -> passed
  - `pnpm dev workflow inboxtask get-document --schema` -> passed
  - `pnpm dev workflow inboxtask approve-patch --help` -> passed and shows `dangerous: true`
  - `pnpm dev workflow inboxtask list-inbox --help` -> passed
- approve-inbox:
  - `node --test skills/iuap-apcom-myapproval/**/*.test.mjs` -> 370 tests passed
  - includes direct-business-fetch guard.

## Notes

- `pnpm build` in bip-cli emitted the existing local warning that `BIP_CLI_GATEWAY_SIGNING_SECRET_ROUTER` is not set, so route signatures are not generated in this local build environment.
- No commit was created.
