# approve-inbox API Commandization Research

Run ID: `approve-inbox-bip-cli-commandization`

## Current Direct YonBIP API Surfaces

- `skills/iuap-apcom-myapproval/scripts/sync-inbox.mjs`
  - Mobile todo list: `/iuap-apcom-messagecenter/client/mobile/todo/items/PC/query`
  - Current tenant probe: `/iuap-yonbuilder-runtime/bill/generateADT`
- `skills/iuap-apcom-myapproval/scripts/fetch-bill-detail.mjs`
  - MDF template/detail: `/mdf-node/uniform/billmeta/getTplId`, `/{service}/billmeta/getbillcommands`, `/mdf-node/meta`, `/{service}/report/detail`, `/{service}/bill/detail`
  - File APIs: `/iuap-apcom-file/rest/fe/file/files`, `/iuap-apcom-file/rest/fe/file/getDownloadUrlWithFileId`, `/iuap-apcom-file/rest/v1/jssdk/queryConfiguration`
  - Workbench identity for file signing: `/iuap-apcom-workbench/me`
  - iForm detail: `/yonbip-ec-iform/iform_ctr/bill_ctr/getFormData`
- `skills/iuap-apcom-myapproval/scripts/frameworks/ynf-client.mjs`
  - YNF detail: `/mdf-node/uniform/ypd/bill/generateADT`, `/iuap-yonbuilder-runtime/ypd/bill/getTplId`, `/tplAndMeta`, `/detail`
- `skills/iuap-apcom-myapproval/scripts/approval-executor.mjs`
  - MDF batch approve/reject: `/iuap-apcom-messagecenter/todocenter/rest/client/patch/batch/async/action`
  - iForm approve/reject/save: `/yonbip-ec-iform/wf_ctr/audit`, `/wf_ctr/doAction`, `/iform_ctr/bill_ctr/loadDataJson`, `/tempsaveData`
- `skills/iuap-apcom-myapproval/scripts/approve-patches.mjs`
  - Patch detail/save: `/iuap-yonbuilder-runtime/bill/detail`, `/iuap-yonbuilder-runtime/bill/save`
- `skills/iuap-apcom-myapproval/scripts/cloud-audit-result.mjs`
  - Intelligent audit result: `/ssc-intelligent-audit/cloudAudit/queryCloudAuditResultDesc`

## bip-cli Existing Fit

- `@bip-cli/iuap-workflow` already owns `workflow task` commands and gateway route exports.
- Existing `workflow task batch-approve` / `batch-reject` use the correct message-center batch action endpoint, but need `dangerous: true` and explicit `apiGatewayRoute`.
- Existing `todo-detail` already contains MDF/iForm resolution helpers, but approve-inbox needs richer output and a stable `document-get` command.

## Migration Matrix

| approve-inbox need | CLI command |
|---|---|
| Sync todo list | `workflow task inbox-list` |
| Fetch MDF/iForm/YNF fields, metadata, attachments | `workflow task document-get` |
| Refresh available actions | `workflow task action-list` |
| MDF approve/reject | `workflow task batch-approve` / `workflow task batch-reject` |
| iForm approve/reject | `workflow task iform-approve` / `workflow task iform-reject` |
| Patch save then approve | `workflow task patch-approve` |
| Intelligent audit summary | `workflow task intelligentresult-get` |

## Constraints From bip-cli Skill

- Use `CommandSpec`; no passthrough wrapper.
- Use `runHttpRequest` for all network requests.
- Add precise gateway routes; app package aggregates them.
- Do not expose tenant arguments for business commands.
- Mark write operations as `dangerous: true`.
